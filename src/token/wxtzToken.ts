import bigInt from 'big-integer';
import { TezosMessageUtils, TezosNodeReader, TezosNodeWriter, TezosParameterFormat } from 'conseiljs';
import { JSONPath } from 'jsonpath-plus';

import { BaseToken, OperationFee, OperationMatch } from '../types/types';

export class wxtzToken implements BaseToken {
    readonly tokenAddress = 'KT1VYsVfmobT7rsMVivvZ4J8i3bPiqz12NaH';
    readonly tokenType = 'tzip7';
    readonly tokenSymbol = 'wXTZ';
    readonly tokenDecimals = 6;
    readonly tokenLedgerMap = 257;
    readonly tokenLedgerKeyType = 'address';
    readonly tokenLedgerPath = '$.int';
    readonly tokenApprovalMap = 256;

    /**
     * 
     * @param server 
     * @param sourceAddress 
     * @param destinationAddress 
     * @param mapIndex 
     * @returns 
     */
    async getApproval(server: string, sourceAddress: string, destinationAddress: string, mapIndex: number = this.tokenApprovalMap): Promise<string> {
        const key = `Pair 0x${TezosMessageUtils.writeAddress(sourceAddress)} 0x${TezosMessageUtils.writeAddress(destinationAddress)}`;
        const packedKey = TezosMessageUtils.encodeBigMapKey(Buffer.from(TezosMessageUtils.writePackedData(key, '', TezosParameterFormat.Michelson), 'hex'));

        try {
            const mapResult = await TezosNodeReader.getValueForBigMapKey(server, mapIndex, packedKey);
            const allowance = JSONPath({ path: '$.int', json: mapResult })[0];
            return allowance;
        } catch (err) {
            return '';
        }
    }

    async getBalance(server: string, sourceAddress: string, mapIndex: number = this.tokenLedgerMap): Promise<string> {
        const packedKey = TezosMessageUtils.encodeBigMapKey(Buffer.from(TezosMessageUtils.writePackedData(sourceAddress, this.tokenLedgerKeyType, TezosParameterFormat.Michelson), 'hex'));
        const mapResult = await TezosNodeReader.getValueForBigMapKey(server, mapIndex, packedKey);

        let tokenBalance = '0';
        try {
            tokenBalance = bigInt(JSONPath({ path: this.tokenLedgerPath, json: mapResult })[0]).toString();
        } catch {
            tokenBalance = ''
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
        const params = `{ "prim": "Pair", "args": [ { "string": "${destinationAddress}" }, { "int": "${amount}" } ] }`;

        return TezosNodeWriter.constructContractInvocationOperation(sourceAddress, counter, this.tokenAddress, 0, fee?.fee || 0, fee?.storage || 0, fee?.gas || 0, 'approve', params);
    }

    matchApproveOperation(operation: any): OperationMatch {
        if (operation['destination'] !== this.tokenAddress) {
            return { match: false, type: '' };
        }

        if (operation['parameters']['entrypoint'] === 'approve') {
            return { match: true, type: 'approve', fee: operation['fee'], gas: operation['gas_limit'] };
        }

        if (JSON.stringify(operation['parameters']['value']).replace(/ /g, '').startsWith('{"prim":"Left","args":[{"prim":"Left","args":[{"prim":"Left","args":[{"prim":"Left","args":[{"prim":"Pair"')) {
            return { match: true, type: 'approve', fee: operation['fee'], gas: operation['gas_limit'] };
        }
    
        return { match: false, type: '' };
    }
}
