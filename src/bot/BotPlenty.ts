import bigInt from 'big-integer';
import winston from 'winston';

import { KeyStore, Signer, TezosConstants, TezosNodeWriter, Transaction } from 'conseiljs';

import * as tezosUtil from '../util/tezosUtil';
import * as arbUtil from '../util/arbUtil';

import { ArbitrageMode, ArbParameters, BaseToken, FeeInstruction, FeeSplitInstruction, OperationFee, RatioParameters, Swap } from '../types/types';

export class BotPlenty {
    private _logger: winston.Logger;

    private _token: BaseToken;
    private _sourceMarket: Swap;
    private _targetMarket: Swap;
    private _cashExchangeMarket: Swap;
    private _config: any; // TODO: type

    private _accountSigner: Signer | undefined;
    private _accountKeyStore: KeyStore | undefined;
    private _accountCounter: number = 0;
    private _cashBalance: string = '0';

    private _groupFeeEstimate: OperationFee[];
    private _notionalDipstick: string[] = [];
    private _feeOverridePadding: number = 0;
    private _feeFloor = 0;
    private _gasFloor = 0;
    private _highFeeCounter = 1;

    constructor(token: BaseToken, sourceMarket: Swap, targetMarket: Swap, cashExchangeMarket: Swap | undefined, config) {
        this._token = token;
        this._sourceMarket = sourceMarket;
        this._targetMarket = targetMarket;
        this._cashExchangeMarket = cashExchangeMarket;
        this._config = config;

        const nativeCashDecimals = 10 ** this._cashExchangeMarket._cashToken.tokenDecimals;
        this._notionalDipstick = [10, 25, 50, 75, 100].map(i => bigInt(i).multiply(nativeCashDecimals).toString());
        this._logger = winston.createLogger({
            exitOnError: false,
            level: 'info',
            format: winston.format.combine(winston.format.timestamp(), winston.format.printf(info => { return `${info['timestamp']}|${info.level}|${info.message}`; })),
            defaultMeta: { service: 'user-service' },
            transports: [
                new winston.transports.Console({ level: 'error' }),
                new winston.transports.File({
                    handleExceptions: true,
                    filename: `log/${this._token.tokenSymbol}-${this._sourceMarket.marketName}-${this._targetMarket.marketName}.log`,
                    maxsize: (5 * 1024 * 1024), // 5 mb
                    maxFiles: 5,
                    tailable: true
                })
            ]
          });
    }

    async init() {
        const accountInfo = await tezosUtil.initAccount(this._config.tezosNode, this._config.accountKey);

        this._accountKeyStore = accountInfo.keyStore;
        this._accountSigner = accountInfo.signer;
        this._accountCounter = accountInfo.counter;

        this._cashBalance = await this._cashExchangeMarket._cashToken.getBalance(this._config.tezosNode, this._accountKeyStore.publicKeyHash);
        const altCashBalance = await this._cashExchangeMarket._assetToken.getBalance(this._config.tezosNode, this._accountKeyStore.publicKeyHash);

        let tokenBalance = '0';
        try {
            tokenBalance = await this._sourceMarket._assetToken.getBalance(this._config.tezosNode, this._accountKeyStore.publicKeyHash);
        } catch (err) {
            this._logger.error(`failed to fetch ${this._sourceMarket._assetToken.tokenSymbol} balance for ${this._accountKeyStore.publicKeyHash}`);
        }

        this._logger.info(`loaded ${this._sourceMarket._assetToken.tokenSymbol} ${this._sourceMarket.marketName}/${this._targetMarket.marketName} bot`);
        this._logger.info(`account ${this._accountKeyStore.publicKeyHash} with counter ${this._accountCounter}, balances ${tokenBalance}${this._sourceMarket._assetToken.tokenSymbol}, ${this._cashBalance}${this._cashExchangeMarket._cashToken.tokenSymbol} and ${altCashBalance}${this._cashExchangeMarket._assetToken.tokenSymbol}`);

        // await this.checkApproval();

        const nativeCashDecimals = 10 ** this._cashExchangeMarket._cashToken.tokenDecimals;
        const balanceSteps = 5; // Math.floor(Math.floor((this._accountBalance - 5_000_000) / 1_000_000) / 50);
        for (let i = 3; i <= balanceSteps; i++){
            if (i < 6) {
                this._notionalDipstick.push(bigInt(i).multiply(50).multiply(nativeCashDecimals).toString()); // 100 -> 300 in 50xtz steps
            } else {
                this._notionalDipstick.push(bigInt(i / 2).multiply(100).multiply(nativeCashDecimals).toString()); // > 300 in 100xtz steps
                i++; // increment by 2, multiply by 100
            }
        }
        this._logger.info(`profit discovery ladder ${this._notionalDipstick.map(n => bigInt(n).divide(nativeCashDecimals)).join(', ')} ${this._cashExchangeMarket._cashToken.tokenSymbol}`);

        this._feeOverridePadding = Math.floor(Math.random() * this._config.feeExtra + this._config.feeExtra); // TODO: config
        this._logger.info(`randomized competing fee padding ${this._feeOverridePadding}`);

        // TODO consider carrying a small balance to make sure that expected token balance can be topped uo to make the sell operation succeed

        try {
            this._groupFeeEstimate = await arbUtil.initFees(this._config.tezosNode, this._sourceMarket, this._targetMarket, this._cashExchangeMarket, this._config.rateTolerance, this._accountKeyStore.publicKeyHash, this._accountCounter, this._feeOverridePadding, this._config.gasExtra, this._config.storageExtra, this._config.splitFee, this._config.nativeCashArb);
            const storageCeiling = this._groupFeeEstimate.map(o => o.storage).reduce((a, c) => a + c, 0) * TezosConstants.StorageRate;
            this._feeFloor = this._groupFeeEstimate.map(o => o.fee).reduce((a, c) => a + c, 0);
            this._gasFloor = this._groupFeeEstimate.map(o => o.gas).reduce((a, c) => a + c, 0);
            this._logger.info(`trade fee, gas estimate: ${this._feeFloor}, ${this._groupFeeEstimate.map(o => o.fee).join('/')} + ${storageCeiling} max storage, ${this._groupFeeEstimate.map(o => o.storage).join('/')}, ${this._groupFeeEstimate.map(o => o.gas).join('/')}`);
        } catch (err) {
            this._logger.error(`failed to estimate fees due to ${JSON.stringify(err)}`);
            throw err;
        }

        this._logger.info(`minimum profit: ${this._config.minimumArb}`);

        // await this.unloadTokens(this._accountCounter, false, 1);
    }

    async run() {
        while (true) {
            const accountState = await tezosUtil.getAccountState(this._config.tezosNode, this._accountKeyStore.publicKeyHash);
            this._accountCounter = accountState.counter;
            //this._cashBalance = accountState.balance; // TODO

            let operationSent = false;
            if (this._config.arbMode === ArbitrageMode.Dynamic) {
                operationSent = await this.dynamicCheck(this._accountCounter, this._config.minimumArb, this._config.expirationPadding, this._config.rateTolerance);
            }

            if (!operationSent) {
                if (this._config.baseAllowance !== '0') { this.checkApproval(); }
                await new Promise(resolve => setTimeout(resolve, this._config.marketRefreshInterval * 1000));
            }
        }
    }

    /**
     * 
     * @param counter Counter to start numbering operations with
     * @param coinBalance XTZ amount for the buy side
     * @param expectedTokenBalance Token amount for the sell side
     * @param expirationPadding Expiration padding for Dexter operations
     * @param rateTolerance Slippage
     * @param feeOverride Total fee override
     * @param ratioOverride Fee per unit gas to use instead of fee override
     * @param feeSplit Fee split instruction override
     * @param useAlternate Submit operation to alternate node
     * @returns 
     */
    async executeArbitrageTrade(counter: number, arbitrage: ArbParameters, expirationPadding: number, rateTolerance: number, feeOverride: number = 0, ratioOverride?: RatioParameters, feeSplit?: FeeSplitInstruction, useAlternate: boolean = false) {
        this._logger.info(`preparing operation group`);

        const expiration = new Date(Date.now() + expirationPadding);

        let groupFee = [ ...this._groupFeeEstimate ];

        if (feeOverride > 0) {
            groupFee = arbUtil.applyFeeSplit(groupFee, (feeSplit ? feeSplit : this._config.splitFee), Math.max(this._feeFloor, feeOverride));
        } else if (ratioOverride !== undefined) {
            try {
                if (ratioOverride.gas > 0) {
                    const totalGas = groupFee.map(o => o.gas).reduce((a, c) => a + c, 0);
                    groupFee[0].gas = ratioOverride.gas - (totalGas - groupFee[0].gas);
                }
                groupFee = arbUtil.applyFeeRatio(groupFee, ratioOverride.ratio);
                const proposedFee = groupFee.map(o => o.fee).reduce((a, c) => a + c, 0);
                if (proposedFee < ratioOverride.fee) {
                    groupFee[0].fee += ratioOverride.fee - proposedFee;
                    this._logger.info(`bumped ratio-based fee by ${ratioOverride.fee - proposedFee}`); // TODO: move into applyFeeRatio
                }
            } catch (err) {
                this._logger.error(`failed to set fee to ratio: ${err}`);
                return;
            }
        }

        let operations: Transaction[] = [];

        if (this._config.nativeCashArb && this._sourceMarket._cashToken.tokenType !== 'coin') {
            const minTokenBalance = bigInt(arbitrage.sourceTokenAmount).toString(); // .minus(bigInt(arbitrage.sourceTokenAmount).divide(rateTolerance)).toString();
            const minSourceNotional = bigInt(arbitrage.sourceCoinAmount).toString(); // .minus(bigInt(arbitrage.sourceCoinAmount).divide(rateTolerance)).toString();

            operations = operations.concat(this._cashExchangeMarket.constructBuyGroup(this._accountKeyStore.publicKeyHash, arbitrage.intermediateCashAmount, arbitrage.tradeNotional, { expiration }));
            operations = operations.concat(this._sourceMarket.constructBuyGroup(this._accountKeyStore.publicKeyHash, minTokenBalance, minSourceNotional, { expiration }));
            operations = operations.concat(this._targetMarket.constructSellGroup(this._accountKeyStore.publicKeyHash, minTokenBalance, arbitrage.tradeNotional, { expiration }));
        } else if (this._config.nativeCashArb && this._targetMarket._cashToken.tokenType !== 'coin') {
            const minTokenBalance = bigInt(arbitrage.sourceTokenAmount).toString(); // .minus(bigInt(arbitrage.sourceTokenAmount).divide(rateTolerance)).toString();
            const minTargetNotional = bigInt(arbitrage.targetCashAmount).toString(); // .minus(bigInt(arbitrage.targetCashAmount).divide(rateTolerance)).toString();

            operations = operations.concat(this._sourceMarket.constructBuyGroup(this._accountKeyStore.publicKeyHash, minTokenBalance, arbitrage.tradeNotional, { expiration }));
            operations = operations.concat(this._targetMarket.constructSellGroup(this._accountKeyStore.publicKeyHash, minTokenBalance, minTargetNotional, { expiration }));
            operations = operations.concat(this._cashExchangeMarket.constructSellGroup(this._accountKeyStore.publicKeyHash, minTargetNotional, arbitrage.tradeNotional, { expiration }));
        } else {
            const minTokenBalance = bigInt(arbitrage.sourceTokenAmount).minus(bigInt(arbitrage.sourceTokenAmount).divide(rateTolerance)).toString();

            operations = operations.concat(this._sourceMarket.constructBuyGroup(this._accountKeyStore.publicKeyHash, minTokenBalance, arbitrage.tradeNotional, { expiration }));
            operations = operations.concat(this._targetMarket.constructSellGroup(this._accountKeyStore.publicKeyHash, arbitrage.sourceTokenAmount, arbitrage.tradeNotional, { expiration }));
        }

        operations = tezosUtil.renumberOperations(operations, counter);
        operations = tezosUtil.overlayOperationFees(operations, groupFee);

        let nodeUrl = this._config.tezosNode;
        if (useAlternate) {
            nodeUrl = this._config.alternateNodes[(new Date()).getTime() % this._config.alternateNodes.length];
        }

        this._logger.info(`awaiting node confirmation`);
        let groupid = 'dry-run';
        try {
            groupid = await tezosUtil.sendOperation(nodeUrl, operations, this._accountSigner); // TODO: this needs a timeout

            // const r = await tezosUtil.preapplyOperation(nodeUrl, operations, this._accountSigner);
            // this._logger.info(`preapply operation, ${JSON.stringify(r)}`);

            this._logger.info(`sent operation, ${JSON.stringify(operations)} to ${nodeUrl} as ${groupid}`);
            process.stdout.write('+');
        } catch (error) {
            if (error.toString().includes('already used for contract')) {
                process.stdout.write('!');
            } else {
                this._logger.error(`failed to send operation, ${JSON.stringify(operations)} to ${nodeUrl} due to ${error}`);
                this._logger.warn(`failure details, ${JSON.stringify(error)}`);
                process.stdout.write('!');
            }
        }

        return groupid;
    }

    async unloadTokens(counter?: number, force: boolean = false, rateTolerance: number = 1) {
        let tokenBalance = '0';
        try {
            tokenBalance = await this._token.getBalance(this._config.tezosNode, this._accountKeyStore.publicKeyHash);
        } catch (err) {
            this._logger.error(`failed to fetch ${this._config.tokenSymbol} balance for ${this._accountKeyStore.publicKeyHash}`);
            return;
        }

        if (Number(tokenBalance) <= 10_000) { return; }

        if (!force && bigInt(Math.pow(10, this._token.tokenDecimals)).divide(tokenBalance).greaterOrEquals(1000)) { return; }

        let _counter = counter;
        if (_counter === undefined) {
            _counter = await tezosUtil.getCounter(this._config.tezosNode, this._accountKeyStore.publicKeyHash);
        }

        tokenBalance = bigInt(tokenBalance).minus(10_000).toString();

        const [sourceState, targetState] = await Promise.all([
            this._sourceMarket.getPoolState(),
            this._targetMarket.getPoolState()]);

        const expectedSourceXtzBalance = this._targetMarket.getTokenToCashExchangeRate(tokenBalance, targetState.tokenBalance, targetState.coinBalance);
        const expectedTargetXtzBalance = this._sourceMarket.getTokenToCashExchangeRate(tokenBalance, sourceState.tokenBalance, sourceState.coinBalance);
        let coinBalance = Math.max(Number(expectedSourceXtzBalance.cashAmount), Number(expectedTargetXtzBalance.cashAmount)).toString();
        coinBalance = bigInt(coinBalance).minus(bigInt(coinBalance).divide(rateTolerance)).toString();

        this._logger.warn(`liquidation "source" ${expectedSourceXtzBalance.cashAmount}, ${targetState.tokenBalance} ${targetState.coinBalance}`)
        this._logger.warn(`liquidation "target" ${expectedTargetXtzBalance.cashAmount}, ${sourceState.tokenBalance} ${sourceState.coinBalance}`)
        this._logger.warn(`liquidation ${tokenBalance}, ${coinBalance}`);

        let operations = [];
        const expiration = new Date(Date.now() + this._config.expirationPadding);
        if (Number(expectedSourceXtzBalance.cashAmount) > Number(expectedTargetXtzBalance.cashAmount)) {
            const approveOperation = this._token.constructApprovalOperation(this._accountKeyStore.publicKeyHash, this._targetMarket.poolAddress, tokenBalance, _counter);
            const sellOperation = this._targetMarket.constructSellOperation(this._accountKeyStore.publicKeyHash, tokenBalance, coinBalance, { expiration }, _counter + 1);
            operations.push(approveOperation);
            operations.push(sellOperation);
        } else if (force && Number(expectedSourceXtzBalance.cashAmount) <= Number(expectedTargetXtzBalance.cashAmount)) {
            const approveOperation = this._token.constructApprovalOperation(this._accountKeyStore.publicKeyHash, this._sourceMarket.poolAddress, tokenBalance, _counter);
            const sellOperation = this._sourceMarket.constructSellOperation(this._accountKeyStore.publicKeyHash, tokenBalance, coinBalance, { expiration }, _counter + 1);
            operations.push(approveOperation);
            operations.push(sellOperation);
        }

        try {
            const estimate = await TezosNodeWriter.estimateOperationGroup(this._config.tezosNode, 'main', operations);

            operations[0].fee = estimate.estimatedFee + this._feeOverridePadding;
            operations[0].gas_limit = estimate.operationResources[0].gas;
            operations[0].storage_limit = estimate.operationResources[0].storageCost;
            operations[1].gas_limit = estimate.operationResources[1].gas;
            operations[1].storage_limit = estimate.operationResources[1].storageCost;
        } catch (error) {
            this._logger.error(`failed to estimate liquidation ${JSON.stringify(operations)} due to ${error}`);
            return;
        }

        try {
            const groupid = await tezosUtil.sendOperation(this._config.tezosNode, operations, this._accountSigner);
            process.stdout.write(')');
            this._logger.info(`sent liquidation operation, ${JSON.stringify(operations)} to ${this._config.tezosNode} as ${groupid}`);
        } catch (error) {
            this._logger.error(`failed to liquidate token balance with ${JSON.stringify(operations)} due to ${error}`);
        }
    }

    async checkApproval() { // TODO: move to tokenUtils
        let allowance = '0';
        try {
            allowance = await this._token.getApproval(this._config.tezosNode, this._accountKeyStore.publicKeyHash, this._targetMarket.poolAddress, this._token.tokenApprovalMap);
        } catch (err) {
            this._logger.error(`failed to fetch ${this._token.tokenSymbol} allowance for ${this._accountKeyStore.publicKeyHash} on ${this._targetMarket.poolAddress}`);
        }

        if (allowance !== this._config.baseAllowance) {
            this._logger.info(`set approval required for ${this._accountKeyStore.publicKeyHash} on ${this._targetMarket.poolAddress} with ${allowance} -> ${this._config.baseAllowance} ${this._token.tokenSymbol}`);
            await this.setApproval(this._config.baseAllowance);
        }
    }

    async setApproval(allowance: string | number) { // TODO: move to tokenUtils
        this._accountCounter = await tezosUtil.getCounter(this._config.tezosNode, this._accountKeyStore.publicKeyHash);

        const clearApproval = this._token.constructApprovalOperation(this._accountKeyStore.publicKeyHash, this._targetMarket.poolAddress, '0', this._accountCounter);
        const setApproval = this._token.constructApprovalOperation(this._accountKeyStore.publicKeyHash, this._targetMarket.poolAddress, `${allowance}`, this._accountCounter + 1);

        let operations: any = [clearApproval];
        if (allowance.toString() !== '0') {
            operations.push(setApproval);
        }

        const estimate = await TezosNodeWriter.estimateOperationGroup(this._config.tezosNode, 'main', operations);
        operations[0].fee = `${estimate.estimatedFee}`;

        for (let i = 0; i < operations.length; i++) {
            operations[i].gas_limit = `${estimate.operationResources[i].gas}`;
            operations[i].storage_limit = `${estimate.operationResources[i].storageCost}`;
        }

        try {
            await tezosUtil.sendOperation(this._config.tezosNode, operations, this._accountSigner);
        } catch (err) {
            this._logger.error(`error attempting to set approval: ${err} with ${JSON.stringify(clearApproval)}`);
        }
    }

    /**
     * Reads the mempool for operations that will alter contract state and attempts to attach around them
     */
    async dynamicCheck(accountCounter: number, minimumArb: number, expirationPadding: number, rateTolerance: number): Promise<boolean> {
        const d = (new Date()).getTime()
        const e = d % 2 === 0;
        let queryNode = this._config.tezosNode
        if (!e) {
            queryNode = this._config.alternateNodes[d % this._config.alternateNodes.length];
        }

        const [pendingOperations, sourceState, targetState, cashState] = await Promise.all([
            tezosUtil.getMempool(queryNode, [this._sourceMarket.poolAddress, this._targetMarket.poolAddress], this._config.siblingAddresses),
            this._sourceMarket.getPoolState(),
            this._targetMarket.getPoolState(),
            this._config.nativeCashArb ? this._cashExchangeMarket.getPoolState() : { coinBalance: '0', tokenBalance: '0', liquidityBalance: '0' }]);

        if (pendingOperations.length > 0) {
            // TODO: probably makes sense to sort operations somehow before processing, maybe by amount, fee, etc
            // TODO: aggregate all operations and arb the total
            pendingOperations.forEach(async (group) => {
                try {
                    const buyMatch = this._targetMarket.matchBuyOperation(group);
                    if (buyMatch.match) {
                        this._logger.info(`observed buy operation ${JSON.stringify(group)} on ${queryNode}`);
                        this._logger.info(`trigger trade ${buyMatch.coinBalance}${this._targetMarket._cashToken.tokenSymbol} -> ${buyMatch.tokenMinimum}${this._targetMarket._assetToken.tokenSymbol}`);
                        this._logger.info(`buy target state: source market ${sourceState.tokenBalance}${this._sourceMarket._assetToken.tokenSymbol}, ${sourceState.coinBalance}${this._sourceMarket._cashToken.tokenSymbol}; target market ${targetState.tokenBalance}${this._targetMarket._assetToken.tokenSymbol}, ${targetState.coinBalance}${this._targetMarket._cashToken.tokenSymbol}; cash market ${cashState.tokenBalance}${this._cashExchangeMarket._assetToken.tokenSymbol}, ${cashState.coinBalance}${this._cashExchangeMarket._cashToken.tokenSymbol}`);

                        const tradeEstimate = this._targetMarket.getCashToTokenExchangeRate(buyMatch.coinBalance, targetState.tokenBalance, targetState.coinBalance);
                        const tradeTokenBalance = bigInt(tradeEstimate.tokenAmount).minus(bigInt(tradeEstimate.tokenAmount).divide(this._config.rateTolerance)).toString(); // TODO: applying own rateTolerance is not ideal, buyMatch.tokenMinimum may be a hint, but may mislead
                        this._logger.info(`expected token output ${tradeTokenBalance}`);

                        const best = arbUtil.calcBestIndirectArb(
                            this._notionalDipstick,
                            sourceState,
                            this._sourceMarket,
                            {
                                coinBalance: bigInt(targetState.coinBalance).plus(buyMatch.coinBalance).toString(),
                                tokenBalance: bigInt(targetState.tokenBalance).minus(tradeTokenBalance).toString(),
                                liquidityBalance: '0'
                            },
                            this._targetMarket,
                            cashState,
                            this._cashExchangeMarket);

                        this._logger.info(`buy target arb: ${JSON.stringify(best)}`);

                        if (best.arb > minimumArb + Number(buyMatch.fee)) {
                            let trailingRatio: RatioParameters;

                            if (this._config.feeDerivation > 0) {
                                trailingRatio = arbUtil.calcGasAdjustedRatio(buyMatch.fee, buyMatch.gas, best.arb / 2, this._gasFloor, 11, 1, 15, this._config.feeDerivation);
                            } else { // FeeDerivationInstruction.Minimum
                                trailingRatio = arbUtil.calcFeeRatio(buyMatch.fee, buyMatch.gas, this._gasFloor);
                            }

                            if (best.arb < minimumArb + trailingRatio.fee) {
                                this._logger.info(`repriced operation unprofitable, ${trailingRatio.fee}x`);
                                return false;
                            }

                            let tradeTolerance = rateTolerance;
                            if (best.arb - minimumArb - Number(buyMatch.fee) > 1000000) { // TODO: improve logic
                                tradeTolerance = 10;
                            }
                            this._logger.info(`dynamic buy arb opportunity for ${best.arb}x (${best.sourceCoinAmount}${this._sourceMarket._cashToken.tokenSymbol} -> ${best.sourceTokenAmount}${this._sourceMarket._assetToken.tokenSymbol} -> ${best.targetCashAmount}${this._targetMarket._cashToken.tokenSymbol}), competing fee/gas: ${buyMatch.fee}/${buyMatch.gas} on ${buyMatch.coinBalance}x with ratio of ${trailingRatio.ratio}, ${trailingRatio.fee}/${trailingRatio.gas}`);
                            await this.executeArbitrageTrade(accountCounter, best, expirationPadding, tradeTolerance, 0, trailingRatio);
                            await new Promise(resolve => setTimeout(resolve, 15_000));
                            return true;
                        } else {
                            this._logger.info(`dynamic buy arb miss on ${best.arb} (${best.tradeNotional} -> ${best.sourceTokenAmount} -> ${best.targetCashAmount}), competing fee/gas: ${buyMatch.fee}/${buyMatch.gas}`);
                        }
                    }

                    const sellMatch = this._sourceMarket.matchSellOperation(group);
                    if (sellMatch.match) {
                        this._logger.info(`observed sell operation ${JSON.stringify(group)} on ${queryNode}`);
                        this._logger.info(`trigger trade ${sellMatch.tokenBalance}${this._sourceMarket._assetToken.tokenSymbol} -> ${sellMatch.coinMinimum}${this._sourceMarket._cashToken.tokenSymbol}`);
                        this._logger.info(`sell target state: source market ${sourceState.tokenBalance}${this._sourceMarket._assetToken.tokenSymbol}, ${sourceState.coinBalance}${this._sourceMarket._cashToken.tokenSymbol}; target market ${targetState.tokenBalance}${this._targetMarket._assetToken.tokenSymbol}, ${targetState.coinBalance}${this._targetMarket._cashToken.tokenSymbol}; cash market ${cashState.tokenBalance}${this._cashExchangeMarket._assetToken.tokenSymbol}, ${cashState.coinBalance}${this._cashExchangeMarket._cashToken.tokenSymbol}`);

                        const tradeEstimate = this._sourceMarket.getTokenToCashExchangeRate(sellMatch.tokenBalance, sourceState.tokenBalance, sourceState.coinBalance);
                        const tradeCoinBalance = bigInt(tradeEstimate.cashAmount).minus(bigInt(tradeEstimate.cashAmount).divide(this._config.rateTolerance)).toString(); // TODO: applying own rateTolerance is not ideal, sellMatch.coinMinimum may be a hint, but may mislead
                        this._logger.info(`expected cash output ${tradeCoinBalance}`);

                        const best = arbUtil.calcBestIndirectArb(
                            this._notionalDipstick,
                            {
                                coinBalance: bigInt(sourceState.coinBalance).minus(tradeCoinBalance).toString(),
                                tokenBalance: bigInt(sourceState.tokenBalance).plus(sellMatch.tokenBalance).toString(),
                                liquidityBalance: '0'
                            },
                            this._sourceMarket,
                            targetState,
                            this._targetMarket,
                            cashState,
                            this._cashExchangeMarket);

                        this._logger.info(`sell target arb: ${JSON.stringify(best)}`);

                        if (best.arb > minimumArb + Number(sellMatch.fee)) {
                            let trailingRatio: RatioParameters;

                            if (this._config.feeDerivation > 0) {
                                trailingRatio = arbUtil.calcGasAdjustedRatio(sellMatch.fee, sellMatch.gas, best.arb / 2, this._gasFloor, 11, 1, 15, this._config.feeDerivation);
                            } else { // FeeDerivationInstruction.Minimum
                                trailingRatio = arbUtil.calcFeeRatio(sellMatch.fee, sellMatch.gas, this._gasFloor);
                            }

                            if (best.arb < minimumArb + trailingRatio.fee) {
                                this._logger.info(`repriced operation unprofitable, ${trailingRatio.fee}x`);
                                return false;
                            }

                            let tradeTolerance = rateTolerance;
                            if (best.arb - minimumArb - Number(sellMatch.fee) > 1000000) { // TODO: improve logic
                                tradeTolerance = 10;
                            }
                            this._logger.info(`in-flight sell arb opportunity for ${best.arb}x (${best.sourceCoinAmount}${this._sourceMarket._cashToken.tokenSymbol} -> ${best.sourceTokenAmount}${this._sourceMarket._assetToken.tokenSymbol} -> ${best.targetCashAmount}${this._targetMarket._cashToken.tokenSymbol}), competing fee/gas: ${sellMatch.fee}/${sellMatch.gas} on ${sellMatch.tokenBalance}t with ratio of ${trailingRatio.ratio}, ${trailingRatio.fee}/${trailingRatio.gas}`);
                            await this.executeArbitrageTrade(accountCounter, best, expirationPadding, tradeTolerance, 0, trailingRatio);

                            await new Promise(resolve => setTimeout(resolve, 15_000));
                            return true;
                        } else {
                            this._logger.info(`in-flight sell arb miss on ${best.arb} (${best.tradeNotional} -> ${best.sourceTokenAmount} -> ${best.targetCashAmount}), competing fee/gas: ${sellMatch.fee}/${sellMatch.gas}`);
                        }
                    }

                    if (!sellMatch.match && !buyMatch.match) {
                        this._logger.warn(`ignored operation: ${JSON.stringify(group)} on ${queryNode}, ${sellMatch.type}, ${buyMatch.type}`);
                    }
                } catch (err) {
                    this._logger.error(`dynamicCheck failed due to: ${JSON.stringify(err)}`);
                    console.log(`plain error ${err}`)
                    console.trace(err);
                }
            });
        } else {
            process.stdout.write('.');
        }

        return false;
    }
}
