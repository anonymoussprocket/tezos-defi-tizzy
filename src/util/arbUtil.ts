import bigInt from 'big-integer';
import { TezosNodeWriter, Transaction } from 'conseiljs';

import * as tezosUtil from './tezosUtil';

import { ArbParameters, FeeDerivationInstruction, FeeSplitInstruction, OperationFee, PoolState, RatioParameters, Swap } from '../types/types';

export async function initFees(tezosNode: string, sourceMarket: Swap, targetMarket: Swap, cashExchangeMarket: Swap = undefined, rateTolerance: number, account: string, counter: number, feeExtra, gasExtra, storageExtra, splitFee: FeeSplitInstruction = FeeSplitInstruction.Split, nativeCashArb: boolean = false): Promise<OperationFee[]> {
    const [sourceState, targetState] = await Promise.all([
        sourceMarket.getPoolState(),
        targetMarket.getPoolState()]);

    let cashState: PoolState;
    if (nativeCashArb) {
        cashState = await cashExchangeMarket.getPoolState();
    }

    const expiration = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    let operations: Transaction[] = [];
    if (nativeCashArb && sourceMarket._cashToken.tokenType !== 'coin') {
        const testNotional = bigInt(10).multiply(10 ** cashExchangeMarket._cashToken.tokenDecimals).toString();
        const intermediateCashAmount = cashExchangeMarket.getCashToTokenExchangeRate(testNotional, cashState.tokenBalance, cashState.coinBalance).tokenAmount;
        const sourceTokenAmount = sourceMarket.getCashToTokenExchangeRate(intermediateCashAmount, sourceState.tokenBalance, sourceState.coinBalance).tokenAmount;
        const targetCashAmount = targetMarket.getTokenToCashExchangeRate(sourceTokenAmount, targetState.tokenBalance, targetState.coinBalance).cashAmount;

        operations = operations.concat(cashExchangeMarket.constructBuyGroup(account, intermediateCashAmount, testNotional, { expiration }));
        operations = operations.concat(sourceMarket.constructBuyGroup(account, sourceTokenAmount, intermediateCashAmount, { expiration }));
        operations = operations.concat(targetMarket.constructSellGroup(account, sourceTokenAmount, targetCashAmount, { expiration }));
    } else if (nativeCashArb && targetMarket._cashToken.tokenType !== 'coin') {
        const testNotional = bigInt(10).multiply(10 ** cashExchangeMarket._cashToken.tokenDecimals).toString();
        const sourceTokenAmount = sourceMarket.getCashToTokenExchangeRate(testNotional, sourceState.tokenBalance, sourceState.coinBalance).tokenAmount;
        const targetCashAmount = targetMarket.getTokenToCashExchangeRate(sourceTokenAmount, targetState.tokenBalance, targetState.coinBalance).cashAmount;
        const intermediateCashAmount = cashExchangeMarket.getTokenToCashExchangeRate(targetCashAmount, cashState.tokenBalance, cashState.coinBalance).cashAmount;

        operations = operations.concat(sourceMarket.constructBuyGroup(account, sourceTokenAmount, testNotional, { expiration }));
        operations = operations.concat(targetMarket.constructSellGroup(account, sourceTokenAmount, targetCashAmount, { expiration }));
        operations = operations.concat(cashExchangeMarket.constructSellGroup(account, targetCashAmount, intermediateCashAmount, { expiration }));
    } else {
        const testNotional = bigInt(10).multiply(10 ** sourceMarket._cashToken.tokenDecimals).toString();
        const sourceTokenAmount = sourceMarket.getCashToTokenExchangeRate(testNotional, sourceState.tokenBalance, sourceState.coinBalance).tokenAmount;
        const targetCashAmount = targetMarket.getTokenToCashExchangeRate(sourceTokenAmount, targetState.tokenBalance, targetState.coinBalance).cashAmount;

        operations = operations.concat(sourceMarket.constructBuyGroup(account, sourceTokenAmount, testNotional, { expiration }));
        operations = operations.concat(targetMarket.constructSellGroup(account, targetCashAmount, testNotional, { expiration }));
    }

    operations = tezosUtil.renumberOperations(operations, counter);

    const estimate = await TezosNodeWriter.estimateOperationGroup(tezosNode, 'main', operations);
    const groupFee: OperationFee[] = estimate.operationResources.map(o => { return { fee: 0, gas: o.gas + gasExtra, storage: o.storageCost + storageExtra }; });
    groupFee[0].fee = estimate.estimatedFee + feeExtra;

    return applyFeeSplit(groupFee, splitFee, estimate.estimatedFee + feeExtra);
}

export function applyFeeSplit(feeEstimate: OperationFee[], feeSplit: FeeSplitInstruction, feeOverride: number): OperationFee[] {
    const _groupFee = [ ...feeEstimate ];

    if (feeSplit === FeeSplitInstruction.First) {
        _groupFee[0].fee = feeOverride;
        for (let i = 1; i < _groupFee.length; i++) { _groupFee[i].fee = 0; }
        return _groupFee;
    }

    if (feeSplit === FeeSplitInstruction.Split) {
        const feePart = Math.ceil(feeOverride / _groupFee.length);
        for (let f of _groupFee) { f.fee = feePart; }
        return _groupFee;
    }

    if (feeSplit === FeeSplitInstruction.Proportion) {
        const feeUnit = feeOverride / _groupFee.map(o => o.gas).reduce((a, c) => a + c, 0);
        for (let f of _groupFee) { f.fee = Math.floor(f.gas * feeUnit); }
        return _groupFee;
    }

    return _groupFee;
}

export function calcBestArb(notionalDipstick: number[], sourceState: PoolState, sourceMarket: Swap, targetState: PoolState, targetMarket: Swap): ArbParameters {
    const maxNotional = notionalDipstick[notionalDipstick.length - 1];
    let last = 0;
    let best: ArbParameters;
    for (let i = 0; i < notionalDipstick.length; i++) {
        let testNotional = notionalDipstick[i];
        let currentArb = calcArbitrage(testNotional, sourceState.tokenBalance, sourceState.coinBalance, sourceMarket, targetState.tokenBalance, targetState.coinBalance, targetMarket);
        if (last === 0) {
            last = currentArb.arb;
            best = currentArb;
            continue;
        }
        if (currentArb.arb < last) { break; }
        last = currentArb.arb;
        best = currentArb;
    }

    if (Number(best.tradeNotional) < maxNotional) {
        let up = calcArbitrage(Math.ceil(Number(best.tradeNotional) * 1.03), sourceState.tokenBalance, sourceState.coinBalance, sourceMarket, targetState.tokenBalance, targetState.coinBalance, targetMarket);
        let down = calcArbitrage(Math.ceil(Number(best.tradeNotional) * 0.97), sourceState.tokenBalance, sourceState.coinBalance, sourceMarket, targetState.tokenBalance, targetState.coinBalance, targetMarket);

        if (up['arb'] > best['arb']) {
            best = up;
            let testNotional = Number(up.tradeNotional);
            while (true) {
                testNotional = Math.ceil(Number(best.tradeNotional) * 1.03);
                up = calcArbitrage(testNotional, sourceState.tokenBalance, sourceState.coinBalance, sourceMarket, targetState.tokenBalance, targetState.coinBalance, targetMarket);
                if (best.arb < up.arb) {
                    best = up;
                } else {
                    break;
                }
            }
        } else if (down['arb'] > best['arb']) {
            best = down;
            let testNotional = Number(down.tradeNotional);
            while (true) {
                testNotional = Math.ceil(Number(best.tradeNotional) * 0.97);
                down = calcArbitrage(testNotional, sourceState.tokenBalance, sourceState.coinBalance, sourceMarket, targetState.tokenBalance, targetState.coinBalance, targetMarket);
                if (best.arb < down.arb) {
                    best = down;
                } else {
                    break;
                }
            }
        }
    }

    return best;
}

export function calcExactArb(sourceState: PoolState, sourceMarket: Swap, targetState: PoolState, targetMarket: Swap): ArbParameters {
    // (xb m tb' m - xb' k tb k)/(xb' k m + xb m m) = ta
    const a = bigInt(targetState.tokenBalance).multiply(bigInt(sourceState.coinBalance)).multiply(bigInt(1_000_000));
    const b = bigInt(sourceState.tokenBalance).multiply(bigInt(targetState.coinBalance)).multiply(bigInt(sourceMarket._exchangeMultiplier)).multiply(bigInt(targetMarket._exchangeMultiplier));
    const n = b.minus(a);
    const d = bigInt(sourceState.coinBalance).multiply(bigInt(1_000_000)).plus(bigInt(targetState.coinBalance).multiply(bigInt(targetMarket._exchangeMultiplier)).multiply(bigInt(1000)));
    const tokenAmount = n.divide(d).divide(2).toString();
    const tradeNotional = (sourceMarket.getTokenToCashExchangeRate(tokenAmount, sourceState.tokenBalance, sourceState.coinBalance)).cashAmount;

    return calcArbitrage(tradeNotional, sourceState.tokenBalance, sourceState.coinBalance, sourceMarket, targetState.tokenBalance, targetState.coinBalance, targetMarket);
}

export function calcArbitrage(tradeNotional, sourceTokenBalance, sourceCoinBalance, sourceMarket: Swap, targetTokenBalance, targetCoinBalance, targetMarket: Swap): ArbParameters {
    const sourceTokenAmount = sourceMarket.getCashToTokenExchangeRate(tradeNotional, sourceTokenBalance, sourceCoinBalance).tokenAmount;
    const targetCashAmount = targetMarket.getTokenToCashExchangeRate(sourceTokenAmount, targetTokenBalance, targetCoinBalance).cashAmount;
    const arb = bigInt(targetCashAmount).minus(tradeNotional).toJSNumber();

    const targetTokenAmount = targetMarket.getCashToTokenExchangeRate(tradeNotional, targetTokenBalance, targetCoinBalance).tokenAmount;
    const sourceCashAmount = sourceMarket.getTokenToCashExchangeRate(targetTokenAmount, sourceTokenBalance, sourceCoinBalance).cashAmount;

    return { arb, sourceTokenAmount, targetCashAmount: targetCashAmount, sourceCoinAmount: sourceCashAmount, targetTokenAmount, tradeNotional };
}

export function calcBestIndirectArb(notionalDipstick: string[], sourceState: PoolState, sourceMarket: Swap, targetState: PoolState, targetMarket: Swap, intermediateState: PoolState, intermediateMarket: Swap): ArbParameters {
    const maxNotional = notionalDipstick[notionalDipstick.length - 1];

    const convert = (sourceMarket._cashToken.tokenType !== 'coin') ? 'input' : 'output';
    let last = 0;
    let best: ArbParameters;
    for (let i = 0; i < notionalDipstick.length; i++) {
        let testNotional = notionalDipstick[i];
        let currentArb = calcIndirectArbitrage(testNotional, convert, sourceState.tokenBalance, sourceState.coinBalance, sourceMarket, targetState.tokenBalance, targetState.coinBalance, targetMarket, intermediateState.tokenBalance, intermediateState.coinBalance, intermediateMarket);
        if (last === 0) {
            last = currentArb.arb;
            best = currentArb;
            continue;
        }
        if (currentArb.arb < last) { break; }
        last = currentArb.arb;
        best = currentArb;
    }

    if (bigInt(best.tradeNotional).lesser(maxNotional)) {
        let up = calcIndirectArbitrage(bigInt(best.tradeNotional).multiply(103).divide(100).toString(), convert, sourceState.tokenBalance, sourceState.coinBalance, sourceMarket, targetState.tokenBalance, targetState.coinBalance, targetMarket, intermediateState.tokenBalance, intermediateState.coinBalance, intermediateMarket);
        let down = calcIndirectArbitrage(bigInt(best.tradeNotional).multiply(97).divide(100).toString(), convert, sourceState.tokenBalance, sourceState.coinBalance, sourceMarket, targetState.tokenBalance, targetState.coinBalance, targetMarket, intermediateState.tokenBalance, intermediateState.coinBalance, intermediateMarket);

        if (up['arb'] > best['arb']) {
            best = up;
            let testNotional = up.tradeNotional;
            while (true) {
                testNotional = bigInt(best.tradeNotional).multiply(103).divide(100).toString()
                up = calcIndirectArbitrage(testNotional, convert, sourceState.tokenBalance, sourceState.coinBalance, sourceMarket, targetState.tokenBalance, targetState.coinBalance, targetMarket, intermediateState.tokenBalance, intermediateState.coinBalance, intermediateMarket);
                if (best.arb < up.arb) {
                    best = up;
                } else {
                    break;
                }
            }
        } else if (down['arb'] > best['arb']) {
            best = down;
            let testNotional = down.tradeNotional;
            while (true) {
                testNotional = bigInt(best.tradeNotional).multiply(97).divide(100).toString();
                down = calcIndirectArbitrage(testNotional, convert, sourceState.tokenBalance, sourceState.coinBalance, sourceMarket, targetState.tokenBalance, targetState.coinBalance, targetMarket, intermediateState.tokenBalance, intermediateState.coinBalance, intermediateMarket);
                if (best.arb < down.arb) {
                    best = down;
                } else {
                    break;
                }
            }
        }
    }

    return best;
}

/**
 * Source market is where the asset being arbitraged is purchased.
 * Target market is where the asset being arbitraged is sold.
 * Intermediate market is where the different cash is converted.
 */
export function calcIndirectArbitrage(tradeNotional: string, convert: 'input' | 'output',
            sourceTokenBalance: string, sourceCoinBalance: string, sourceMarket: Swap,
            targetTokenBalance: string, targetCoinBalance: string, targetMarket: Swap,
            intermediateTokenBalance: string, intermediateCoinBalance: string, intermediateMarket: Swap
        ): ArbParameters {
    let arb, sourceTokenAmount, targetCashAmount, sourceCashAmount, targetTokenAmount, intermediateCashAmount;

    try {
        if (convert === 'output') {
            /*
                source: c -> t
                target: t -> c'
                intermediate: c' -> c
            */
            sourceTokenAmount = sourceMarket.getCashToTokenExchangeRate(tradeNotional, sourceTokenBalance, sourceCoinBalance).tokenAmount;
            targetCashAmount = targetMarket.getTokenToCashExchangeRate(sourceTokenAmount, targetTokenBalance, targetCoinBalance).cashAmount;
            intermediateCashAmount = intermediateMarket.getTokenToCashExchangeRate(targetCashAmount, intermediateTokenBalance, intermediateCoinBalance).cashAmount;

            arb = bigInt(intermediateCashAmount).minus(tradeNotional).toJSNumber();
            targetTokenAmount = targetMarket.getCashToTokenExchangeRate(targetCashAmount, targetTokenBalance, targetCoinBalance).tokenAmount;
            sourceCashAmount = sourceMarket.getTokenToCashExchangeRate(targetTokenAmount, sourceTokenBalance, sourceCoinBalance).cashAmount;
        } else {
            /*
                intermediate: c -> c'
                source: c' -> t
                target t -> c
            */
            intermediateCashAmount = intermediateMarket.getCashToTokenExchangeRate(tradeNotional, intermediateTokenBalance, intermediateCoinBalance).tokenAmount;
            sourceTokenAmount = sourceMarket.getCashToTokenExchangeRate(intermediateCashAmount, sourceTokenBalance, sourceCoinBalance).tokenAmount;
            targetCashAmount = targetMarket.getTokenToCashExchangeRate(sourceTokenAmount, targetTokenBalance, targetCoinBalance).cashAmount;

            arb = bigInt(targetCashAmount).minus(tradeNotional).toJSNumber();
            targetTokenAmount = targetMarket.getCashToTokenExchangeRate(tradeNotional, targetTokenBalance, targetCoinBalance).tokenAmount;
            sourceCashAmount = sourceMarket.getTokenToCashExchangeRate(sourceTokenAmount, sourceTokenBalance, sourceCoinBalance).cashAmount;
        }
    } catch (err) {
        console.log(`failed in calcIndirectArbitrage\n\tinput: tradeNotional ${tradeNotional}, convert ${convert}, sourceTokenBalance ${sourceTokenBalance}, sourceCoinBalance ${sourceCoinBalance}, targetTokenBalance ${targetTokenBalance}, targetCoinBalance ${targetCoinBalance}, intermediateTokenBalance ${intermediateTokenBalance}, intermediateCoinBalance ${intermediateCoinBalance}\n\tintermediate: arb ${arb}, sourceTokenAmount ${sourceTokenAmount}, targetCashAmount ${targetCashAmount}, sourceCashAmount ${sourceCashAmount}, targetTokenAmount ${targetTokenAmount}, intermediateCashAmount ${intermediateCashAmount}`);
        throw err;
    }

    return {
        arb,
        sourceTokenAmount,
        targetCashAmount: targetCashAmount,
        sourceCoinAmount: sourceCashAmount,
        targetTokenAmount,
        tradeNotional,
        intermediateCashAmount };
}

/**
 * 
 * @param groupFee 
 * @param targetRatio Average fee to unit-gas ratio to match
 * @param feePadding
 * @returns 
 */
export function applyFeeRatio(feeEstimate: OperationFee[], targetRatio: number): OperationFee[] {
    const groupFee = [ ...feeEstimate ];

    for (let i = 0; i < groupFee.length; i++) {
        groupFee[i].fee = Math.floor(groupFee[i].gas * targetRatio);
        if (feeEstimate[i].gas / 10 > groupFee[i].fee) {
            throw new Error(`cannot price transaction ${i} at ${targetRatio} for ${feeEstimate[i].gas} gas with ${groupFee[i].fee} fee, off by ${(feeEstimate[i].gas / 10) - groupFee[i].fee}`);
        }
    }

    return groupFee;
}

/**
 * Calculates the fee to unit-gas ratio that can be used to price a transaction in relative terms to attempt ordered block inclusion. 1µtz is 10 units of gas.
 * 
 * @param fee Target fee in µtz
 * @param gas Target gas
 * @param expectedGas Sample gas amount to use to reduce the ratio just enough so that produces a fee just below target.
 * @param decimals Precision to return
 * @returns 
 */
 export function calcFeeRatio(fee: number | string, gas: number | string, expectedGas: number, decimals: number = 5): RatioParameters {
    const scaledFee = bigInt(fee.toString()).multiply(10 ** (decimals + 1));
    const scaledGas = bigInt(gas.toString());
    const ratio = scaledFee.divide(scaledGas);

    let truncatedRatio = ratio.toString().slice(0, decimals);
    const boundaryFee = Math.ceil(Number(`0.${truncatedRatio}`) * expectedGas);
    let lowerFee = Math.ceil(Number(`0.${truncatedRatio}`) * expectedGas);
    while (lowerFee >= boundaryFee) {
        const ratio = Number(truncatedRatio) - 1;
        truncatedRatio = ratio.toString();
        lowerFee = Math.ceil(Number(`0.${truncatedRatio}`) * expectedGas);
    }

    return { ratio: Number(`0.${truncatedRatio}`), gas: expectedGas, fee: lowerFee };
}

/**
 * Calculates the fee to unit-gas ratio that can be used to price a transaction in relative terms to attempt ordered block inclusion. 1µtz is 10 units of gas.
 * 
 * @param fee Target fee in µtz.
 * @param gas Target gas.
 * @param boundaryFee Max acceptable fee in µtz based on expected profit.
 * @param expectedGas Sample gas amount to use to reduce the ratio just enough so that produces a fee just below target.
 * @param decimals Ratio precision
 * @returns 
 */
export function calcGasAdjustedRatio(fee: number | string, gas: number | string, boundaryFee: number, expectedGas: number, decimals: number = 10, gasIncrement: number = 2, ratioOffset: number = 3, derivation: FeeDerivationInstruction = FeeDerivationInstruction.GasAscending): RatioParameters {
    const scale = bigInt(10 ** decimals);
    const scaledFee = bigInt(fee.toString()).multiply(scale);
    const ratio = scaledFee.divide(gas);

    const boundaryRatio = bigInt(ratio.toString().slice(0, decimals)); 
    const targetRatio = Number(`0.${boundaryRatio}`);
    const targetRatioInt = boundaryRatio.minus(ratioOffset);

    const { alternateGas, alternateFee } = __calcGasAdjustedRatio(boundaryFee, expectedGas, gasIncrement, derivation, targetRatio, targetRatioInt, scale);

    if (alternateFee >= boundaryFee) {
        return { ratio: -1, gas: -1, fee: -1 };
    }

    return {
        ratio: Number(`0.${bigInt(alternateFee.toString()).multiply(scale).divide(alternateGas).toString().slice(0, decimals)}`),
        gas: alternateGas,
        fee: alternateFee
    };
}

function __calcGasAdjustedRatio(boundaryFee: number, expectedGas: number, gasIncrement, derivation: FeeDerivationInstruction,
    targetRatio: number, targetRatioInt, scale) {
    let alternateGas = (derivation === FeeDerivationInstruction.GasDescending) ? 1_040_000 : expectedGas;
    let alternateFee = 0;

    if (derivation === FeeDerivationInstruction.GasDescending) {
        while (alternateFee < boundaryFee && alternateGas > expectedGas) {
            alternateGas -= gasIncrement;
            alternateFee = Math.floor(targetRatio * alternateGas);
            let scaledAlternateFee = bigInt(alternateFee).multiply(scale);
            let alternateRatio = scaledAlternateFee.divide(alternateGas);
            if (alternateRatio.greater(targetRatioInt)) { break; }
        }
    } else {
        while (alternateFee < boundaryFee && alternateGas < 1_040_000) {
            alternateGas += gasIncrement;
            alternateFee = Math.floor(targetRatio * alternateGas);
            let scaledAlternateFee = bigInt(alternateFee).multiply(scale);
            let alternateRatio = scaledAlternateFee.divide(alternateGas);
            if (alternateRatio.greater(targetRatioInt)) { break; }
        }
    }

    return { alternateGas, alternateFee };
}
