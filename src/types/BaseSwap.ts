import { JSONPath } from 'jsonpath-plus';
import bigInt from 'big-integer';
import { TezosNodeReader } from 'conseiljs';

import { BaseToken, PoolState, PoolStorageMap } from '../types/types';

export class BaseSwap {
    readonly _exchangeMultiplier: string;
    readonly _assetToken: BaseToken;
    readonly _cashToken: BaseToken;

    constructor(assetToken: BaseToken, cashToken: BaseToken, exchangeMultiplier: string) {
        this._exchangeMultiplier = exchangeMultiplier;
        this._assetToken = assetToken;
        this._cashToken = cashToken;
    }

    /**
     * Calculate the token requirement for the proposed XTZ deposit.
     * 
     * @param cashDeposit XTZ amount of the proposed transaction
     * @param tokenBalance Pool token balance
     * @param cashBalance Pool XTZ balance
     * @return {number} Matching token balance for the proposed deposit
     */
    calcTokenLiquidityRequirement(cashDeposit: number, tokenBalance: number, cashBalance: number): number {
        return bigInt(cashDeposit).multiply(bigInt(tokenBalance)).divide(bigInt(cashBalance)).toJSNumber();
    }

    /**
     * XTZ/Token exchange rate for a given XTZ trade.
     * 
     * @param cashAmount Proposed XTZ deposit
     * @param tokenBalance Current token balance in the pool
     * @param cashBalance Current XTZ balance in the pool
     */
    getCashToTokenExchangeRate(cashAmount: string, tokenBalance: string, cashBalance: string) {
        const n = bigInt(cashAmount).multiply(bigInt(tokenBalance)).multiply(bigInt(this._exchangeMultiplier));
        const d = bigInt(cashBalance).multiply(bigInt(1000)).add(bigInt(cashAmount).multiply(bigInt(this._exchangeMultiplier))); // TODO: 1000

        const tokenAmount = n.divide(d);
        const dm = tokenAmount.divmod(bigInt(cashAmount));
        const f = dm.remainder.multiply(bigInt(10 ** this._cashToken.tokenDecimals)).divide(bigInt(cashAmount));

        return { tokenAmount: tokenAmount.toString(), rate: parseFloat(`${dm.quotient.toJSNumber()}.${f.toJSNumber()}`) };
    }


    getCashToTokenInverse(cashAmount: string, tokenBalance: string, cashBalance: string) {
        const n = bigInt(cashAmount).multiply(bigInt(tokenBalance)).multiply(bigInt(this._exchangeMultiplier));
        const d = bigInt(cashBalance).multiply(bigInt(1000)).add(bigInt(cashAmount).multiply(bigInt(this._exchangeMultiplier))); // TODO: 1000

        const tokenAmount = n.divide(d);
        const dm = tokenAmount.divmod(bigInt(cashAmount));
        const f = dm.remainder.multiply(bigInt(10 ** this._cashToken.tokenDecimals)).divide(bigInt(cashAmount));

        return { tokenAmount: tokenAmount.toString(), rate: parseFloat(`${dm.quotient.toJSNumber()}.${f.toJSNumber()}`) };
    }

    /**
     * Token/XTZ exchange rate for a given token sale.
     * @param tokenAmount 
     * @param tokenBalance 
     * @param cashBalance 
     * @returns 
     */
    getTokenToCashExchangeRate(tokenAmount: string, tokenBalance: string, cashBalance: string) {
        const n = bigInt(tokenAmount).multiply(bigInt(cashBalance)).multiply(bigInt(this._exchangeMultiplier));
        const d = bigInt(tokenBalance)
            .multiply(bigInt(1000))
            .add(bigInt(tokenAmount).multiply(bigInt(this._exchangeMultiplier)));

        const cashAmount = n.divide(d);
        const dm = cashAmount.divmod(bigInt(tokenAmount));
        const f = dm.remainder.multiply(bigInt(10 ** this._assetToken.tokenDecimals)).divide(bigInt(tokenAmount));

        return { cashAmount: cashAmount.toString(), rate: parseFloat(`${dm.quotient.toJSNumber()}.${f.toJSNumber()}`) };
    }

    /**
     * Token/XTZ exchange rate for a given token purchase.
     * 
     * @param tokenAmount 
     * @param tokenBalance 
     * @param cashBalance 
     * @returns 
     */
    getTokenToCashInverse(tokenAmount: string, tokenBalance: string, cashBalance: string) {
        const n = bigInt(tokenAmount).multiply(bigInt(cashBalance)).multiply(bigInt(1000));
        const d = bigInt(tokenBalance)
            .multiply(bigInt(this._exchangeMultiplier))
            .subtract(bigInt(tokenAmount).multiply(bigInt(this._exchangeMultiplier)));
    
        const amount = n.divide(d);
        const rate = amount.divmod(bigInt(tokenAmount));
        const ff = rate.remainder.multiply(bigInt(10 ** this._assetToken.tokenDecimals)).divide(bigInt(tokenAmount));
    
        return { cashAmount: amount.toJSNumber(), rate: parseFloat(`${rate.quotient.toJSNumber()}.${ff.toJSNumber()}`) };
    }

    async getPoolState(server: string, address: string, storageMap: PoolStorageMap): Promise<PoolState> {
        const storageResult = await TezosNodeReader.getContractStorage(server, address);

        const tokenBalance = JSONPath({ path: storageMap.tokenBalancePath, json: storageResult })[0];
        const xtzBalance = JSONPath({ path: storageMap.coinBalancePath, json: storageResult })[0];
        const liquidityBalance = JSONPath({ path: storageMap.liquidityBalancePath, json: storageResult })[0];

        return {
            coinBalance: xtzBalance,
            tokenBalance: tokenBalance,
            liquidityBalance: liquidityBalance
        };
    }
}
