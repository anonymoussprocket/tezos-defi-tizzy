import { TezosNodeReader, Transaction } from 'conseiljs';
import { BaseToken, OperationFee, OperationMatch } from '../types/types';

export class xtzCoin implements BaseToken {
    readonly tokenAddress = '';
    readonly tokenType = 'coin';
    readonly tokenSymbol = 'xtz';
    readonly tokenDecimals = 6;
    readonly tokenLedgerMap = -1;
    readonly tokenLedgerKeyType = '';
    readonly tokenLedgerPath = '';
    readonly tokenApprovalMap = -1;
    readonly tokenApprovalPath = '';

    async getApproval(server: string, sourceAddress: string, destinationAddress: string, mapIndex: number = this.tokenLedgerMap): Promise<string> {
        throw new Error('unsupported operation');
    }

    async getBalance(server: string, sourceAddress: string, mapIndex: number = this.tokenLedgerMap): Promise<string> {
        const n = await TezosNodeReader.getSpendableBalanceForAccount(server, sourceAddress);
        return n.toString();
    }

    constructApprovalOperation(sourceAddress: string, destinationAddress: string, amount: string = '0', counter: number = 0, fee?: OperationFee): Transaction {
        throw new Error('unsupported operation');
    }

    matchApproveOperation(operation: any): OperationMatch {
        throw new Error('unsupported operation');
    }
}
