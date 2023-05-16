import { TezosMessageUtils, TezosNodeReader, TezosNodeWriter, TezosLanguageUtil, TezosParameterFormat } from 'conseiljs';
import { JSONPath } from 'jsonpath-plus';

import { BaseToken, OperationFee, OperationMatch } from '../types/types'

export class tzbtcToken implements BaseToken {
    readonly tokenAddress = 'KT1PWx2mnDueood7fEmfbBDKx1D9BAnnXitn';
    readonly tokenType = 'tzip7';
    readonly tokenSymbol = 'tzBTC';
    readonly tokenDecimals = 8;
    readonly tokenLedgerMap = 31;
    readonly tokenLedgerKeyType = 'address';
    readonly tokenLedgerPath = '$.args[0].int';
    readonly tokenApprovalMap = 31;

    /**
     * 
     * @param server 
     * @param sourceAddress 
     * @param destinationAddress 
     * @param mapIndex 
     * @returns 
     */
    async getApproval(server: string, sourceAddress: string, destinationAddress: string, mapIndex: number = this.tokenLedgerMap): Promise<string> {
        try {
            const mapResult = await this.queryMap(server, mapIndex, `(Pair "ledger" 0x${TezosMessageUtils.writeAddress(sourceAddress)})`);
            let allowances = new Map<string, string>();
            JSONPath({ path: '$.args[1][*].args', json: mapResult }).forEach(v => allowances[TezosMessageUtils.readAddress(v[0]['bytes'])] = v[1]['int']);

            return allowances[destinationAddress] || '0';
        } catch (err) {
            return '';
        }
    }

    async getBalance(server: string, sourceAddress: string, mapIndex: number = this.tokenLedgerMap): Promise<string> {
        let tokenBalance = '0';
        try {
            const mapResult = await this.queryMap(server, mapIndex, `(Pair "ledger" 0x${TezosMessageUtils.writeAddress(sourceAddress)})`);
            tokenBalance = JSONPath({ path: '$.args[0].int', json: mapResult })[0];
        } catch (err) {
            return '';
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

        if (JSON.stringify(operation['parameters']['value']).replace(/ /g, '').startsWith('{"prim":"Right","args":[{"prim":"Right","args":[{"prim":"Right","args":[{"prim":"Right","args":[{"prim":"Left","args":[{"prim":"Right","args":[{"prim":"Right","args":[{"prim":"Right","args":[{"prim":"Pair"')) {
            return { match: true, type: 'approve', fee: operation['fee'], gas: operation['gas_limit'] };
        }
    
        return { match: false, type: '' };
    }

    private async queryMap(server: string, mapid: number, query: string): Promise<any> {
        const key = Buffer.from(TezosMessageUtils.writePackedData(query, '', TezosParameterFormat.Michelson), 'hex');
        const packedKey = TezosMessageUtils.writePackedData(key, 'bytes');
        const encodedKey = TezosMessageUtils.encodeBigMapKey(Buffer.from(packedKey, 'hex'));
        const mapResult = await TezosNodeReader.getValueForBigMapKey(server, mapid, encodedKey);

        if (mapResult === undefined) { throw new Error(`Could not get data from map ${mapid} for '${query}'`); }
        const bytes = JSONPath({ path: '$.bytes', json: mapResult })[0];
        return JSON.parse(TezosLanguageUtil.hexToMicheline(bytes.slice(2)).code);
    }
}
