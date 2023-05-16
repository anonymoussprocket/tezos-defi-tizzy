import bigInt from 'big-integer';
import { TezosMessageUtils, TezosNodeReader, TezosNodeWriter, TezosParameterFormat } from 'conseiljs';
import { JSONPath } from 'jsonpath-plus';

import { BaseToken, OperationFee, OperationMatch } from '../types/types';

export class BaseWrapToken implements BaseToken {
    readonly tokenAddress = 'KT18fp5rcTW7mbWDmzFwjLDUhs5MeJmagDSZ';
    readonly tokenType = 'tzip12';
    tokenIndex = -1;
    tokenSymbol = '';
    tokenDecimals = -1;
    readonly tokenLedgerMap = 1772;
    readonly tokenLedgerKeyType = 'pair (address nat)';
    readonly tokenLedgerPath = 'int';
    readonly tokenApprovalMap = 1773;
    readonly tokenApprovalKeyType = 'pair (address pair (address nat))';

    constructor(tokenIndex: number, tokenSymbol: string, tokenDecimals: number) {
        this.tokenIndex = tokenIndex;
        this.tokenSymbol = tokenSymbol;
        this.tokenDecimals = tokenDecimals;
    }

    /**
     * 
     * @param server 
     * @param sourceAddress 
     * @param destinationAddress 
     * @param mapIndex 
     * @returns 
     */
    async getApproval(server: string, sourceAddress: string, destinationAddress: string, mapIndex: number = this.tokenApprovalMap): Promise<string> {
        const sourceHex = `0x${TezosMessageUtils.writeAddress(sourceAddress)}`;
        const destinationHex = `0x${TezosMessageUtils.writeAddress(destinationAddress)}`;
        const packedKey = TezosMessageUtils.encodeBigMapKey(Buffer.from(TezosMessageUtils.writePackedData(`(Pair ${sourceHex} (Pair ${destinationHex} ${this.tokenIndex}))`, this.tokenApprovalKeyType, TezosParameterFormat.Michelson), 'hex'));

        try {
            const mapResult = await TezosNodeReader.getValueForBigMapKey(server, mapIndex, packedKey);
            return JSONPath({ path: '$.prim', json: mapResult }) === 'Unit' ? '1' : '0';
        } catch (err) {
            return '0';
        }
    }

    async getBalance(server: string, sourceAddress: string, mapIndex: number = this.tokenLedgerMap): Promise<string> {
        const addressHex = `0x${TezosMessageUtils.writeAddress(sourceAddress)}`;
        const packedKey = TezosMessageUtils.encodeBigMapKey(Buffer.from(TezosMessageUtils.writePackedData(`(Pair ${addressHex} ${this.tokenIndex})`, this.tokenLedgerKeyType, TezosParameterFormat.Michelson), 'hex'));

        let tokenBalance = '0';
        try {
            const mapResult = await TezosNodeReader.getValueForBigMapKey(server, mapIndex, packedKey);
            tokenBalance = bigInt(JSONPath({ path: this.tokenLedgerPath, json: mapResult })[0]).toString();
        } catch (err) {
            return '0';
        }

        return tokenBalance;
    }

    /**
     * Creates an approval operation which requires the counter, fee, gas and storage estimates to be set.
     * 
     * @param sourceAddress 
     * @param destinationAddress 
     * @param amount 
     * @param counter
     * @param fee
     * @returns 
     */
    constructApprovalOperation(sourceAddress: string, destinationAddress: string, amount: string = '0', counter: number = 0, fee?: OperationFee) {
        const params = `[{ "prim": "Left", "args": [{ "prim": "Pair", "args": [{ "string": "${sourceAddress}" }, { "prim": "Pair", "args": [{ "string": "${destinationAddress}" }, { "int": "${this.tokenIndex}" }] }] }] }]`;

        return TezosNodeWriter.constructContractInvocationOperation(sourceAddress, counter, this.tokenAddress, 0, fee?.fee || 0, fee?.storage || 0, fee?.gas || 0, 'update_operators', params);
    }

    matchApproveOperation(operation: any): OperationMatch {
        if (operation['destination'] !== this.tokenAddress) {
            return { match: false, type: '' };
        }

        if (operation['parameters']['entrypoint'] === 'update_operators') {
            return { match: true, type: 'approve', fee: operation['fee'], gas: operation['gas_limit'] };
        }

        return { match: false, type: '' };
    }
}
