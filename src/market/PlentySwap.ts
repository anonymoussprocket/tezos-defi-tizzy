import { TezosNodeWriter, Transaction } from 'conseiljs';
import { JSONPath } from 'jsonpath-plus';
import { plentyToken } from '../token/plentyToken';

import { BaseSwap, BaseToken, OperationFee, OperationMatch, PoolState, PoolStorageMap } from '../types/types'

export class PlentySwap extends BaseSwap {
    readonly poolAddress: string;
    readonly _storageMap: PoolStorageMap;
    readonly _otherPools: string[];
    readonly _tezosNode: string;
    readonly marketName: string;

    constructor(poolAddress: string, storageMap: PoolStorageMap, exchangeMultiplier: string, token: BaseToken, otherPools: string[], tezosNode: string) {
        super(token, new plentyToken(), exchangeMultiplier);

        this.poolAddress = poolAddress;
        this._storageMap = storageMap;
        this._otherPools = otherPools;
        this._tezosNode = tezosNode;

        this.marketName = 'Plenty';
    }

    /**
     * Creates a sell operation to exchange tokens for coins. Counter, fee, gas and storage estimates must be set after the fact.
     * 
     * @param sourceAddress 
     * @param size Number of tokens to sell
     * @param notional Cash amount to get
     * @param options
     * @param counter
     * @param fee
     * 
     * @returns 
     */
    constructSellOperation(sourceAddress: string, size: string, notional: string, options?: any, counter: number = 0, fee?: OperationFee): Transaction {
        const params = `{ "prim": "Pair", "args": [{ "prim": "Pair", "args": [{ "int": "${notional}" }, { "string": "${sourceAddress}" }] }, { "prim": "Pair", "args": [{ "string": "${this._cashToken.tokenAddress}" }, { "prim": "Pair", "args": [{ "int": "0" }, { "int": "${size}" }] }] }] }`;

        return TezosNodeWriter.constructContractInvocationOperation(sourceAddress, counter, this.poolAddress, 0, fee?.fee || 0, fee?.storage || 0, fee?.gas || 0, 'Swap', params);
    }

    constructSellGroup(sourceAddress: string, size: string, notional: string, options?: any): Transaction[] {
        const approveToken = this._assetToken.constructApprovalOperation(sourceAddress, this.poolAddress, size);
        const sellToken = this.constructSellOperation(sourceAddress, size, notional, options);

        return [approveToken, sellToken];
    }

    /**
     * Creates a purchase operation to exchange coins for tokens. Counter, fee, gas and storage estimates must be set after the fact.
     * 
     * @param sourceAddress 
     * @param size 
     * @param notional
     * @param expiration
     * @param counter 
     * @param fee 
     * @returns 
     */
    constructBuyOperation(sourceAddress: string, size: string, notional: string, options?: any, counter: number = 0, fee?: OperationFee) {
        const params = `{ "prim": "Pair", "args": [{ "prim": "Pair", "args": [{ "int": "${size}" }, { "string": "${sourceAddress}" }] }, { "prim": "Pair", "args": [{ "string": "${this._assetToken.tokenAddress}" }, { "prim": "Pair", "args": [{ "int": "${this._assetToken.tokenIndex || 0}" }, { "int": "${notional}" }] }] }] }`;

        return TezosNodeWriter.constructContractInvocationOperation(sourceAddress, counter, this.poolAddress, 0, fee?.fee || 0, fee?.storage || 0, fee?.gas || 0, 'Swap', params);
    }

    constructBuyGroup(sourceAddress: string, size: string, notional: string, options?: any): Transaction[] {
        const approveCash = this._cashToken.constructApprovalOperation(sourceAddress, this.poolAddress, notional);
        const buyToken = this.constructBuyOperation(sourceAddress, size, notional, options);

        return [approveCash, buyToken];
    }

    async getPoolState(): Promise<PoolState> {
        return super.getPoolState(this._tezosNode, this.poolAddress, this._storageMap);
    }

    matchBuyOperation(operationGroup: any[]): OperationMatch {
        let arbContractIndex = -1;
        let tokenApprovalIndex = -1;
        let marketBuyIndex = -1;
        let match: OperationMatch;
        let accumulatedFee = 0;
        let accumulatedGas = 0;

        for (let i = 0; i < operationGroup.length; i++) {
            const o = operationGroup[i];

            if (o === undefined) { continue; }

            accumulatedFee += Number(o['fee']);
            accumulatedGas += Number(o['gas_limit']);

            if (o['parameters'] === undefined) { continue; }

            if (this._otherPools.includes(o['destination'])) {
                arbContractIndex = i;
                continue;
            }

            if (this._assetToken.matchApproveOperation(o).match) {
                tokenApprovalIndex = i;
                continue;
            }

            if (o['destination'] === this.poolAddress && o['parameters']['entrypoint'] === 'Swap') {
                const params = o['parameters']['value'];

                const tokenAddress = JSONPath({ path: '$.args[1].args[0].string', json: params })[0]; // TODO: could be bytes
                const tokenIndex = JSONPath({ path: '$.args[1].args[1].args[0].int', json: params })[0];
                if (tokenAddress !== this._assetToken.tokenAddress) { continue; }
                if (this._assetToken.tokenType === 'tzip12' && Number(tokenIndex) !== this._assetToken.tokenIndex) { continue; }

                const coinBalance = JSONPath({ path: '$.args[1].args[1].args[1].int', json: params })[0];
                const tokenMinimum = JSONPath({ path: '$.args[0].args[0].int', json: params })[0];

                match = { match: true, type: 'buy', tokenMinimum, coinBalance };
                marketBuyIndex = i;
                continue;
            }
        }

        if (marketBuyIndex < 0) {
            return { match: false, type: 'no_buy' };
        }

        if (arbContractIndex >= 0 && arbContractIndex > marketBuyIndex) {
            return { match: false, type: 'buy_arb' };
        }

        match.fee = accumulatedFee.toString();
        match.gas = accumulatedGas.toString();
        return match;
    }

    matchSellOperation(operationGroup: any[]): OperationMatch {
        let arbContractIndex = -1;
        let tokenApprovalIndex = -1;
        let marketSaleIndex = -1;
        let match: OperationMatch;
        let accumulatedFee = 0;
        let accumulatedGas = 0;

        for (let i = 0; i < operationGroup.length; i++) {
            const o = operationGroup[i];

            if (o === undefined) { continue; }

            accumulatedFee += Number(o['fee']);
            accumulatedGas += Number(o['gas_limit']);

            if (o['parameters'] === undefined) { continue; }

            if (this._otherPools.includes(o['destination'])) {
                arbContractIndex = i;
                continue;
            }

            if (this._assetToken.matchApproveOperation(o).match) {
                tokenApprovalIndex = i;
                continue;
            }

            if (o['destination'] === this.poolAddress && o['parameters']['entrypoint'] === 'Swap') {
                const params = o['parameters']['value'];

                const tokenAddress = JSONPath({ path: '$.args[1].args[0].string', json: params })[0]; // TODO: could be bytes
                const tokenIndex = JSONPath({ path: '$.args[1].args[1].args[0].int', json: params })[0];
                if (tokenAddress !== this._cashToken.tokenAddress) { continue; }
                if (this._cashToken.tokenType === 'tzip12' && Number(tokenIndex) !== this._cashToken.tokenIndex) { continue; }

                const tokenBalance = JSONPath({ path: '$.args[1].args[1].args[1].int', json: params })[0];
                const coinMinimum = JSONPath({ path: '$.args[0].args[0].int', json: params })[0];

                match = { match: true, type: 'sell', tokenBalance, coinMinimum };
                marketSaleIndex = i;
                continue;
            }
        }

// (pair (pair (nat %MinimumTokenOut) (address %recipient))
//                             (pair (address %requiredTokenAddress /*input token */)
//                                   (pair (nat %requiredTokenId) (nat %tokenAmountIn)))))


        if (marketSaleIndex < 0) {
            return { match: false, type: 'no_sell' };
        }

        if (arbContractIndex >= 0 && arbContractIndex < marketSaleIndex) {
            return { match: false, type: 'sell_arb' };
        }

        match.fee = accumulatedFee.toString();
        match.gas = accumulatedGas.toString();
        return match;
    }
}
