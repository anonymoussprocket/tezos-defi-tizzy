import { Transaction } from 'conseiljs';
import { OperationFee, OperationMatch } from '../types/types';

export interface BaseToken {
    tokenAddress: string;
    tokenIndex?: number;
    tokenType: 'tzip7' | 'tzip12' | 'coin';
    tokenSymbol: string;
    tokenDecimals: number;
    tokenLedgerMap: number;
    tokenLedgerKeyType: string;
    tokenLedgerPath: string;
    tokenApprovalMap: number;

    getApproval(server: string, sourceAddress: string, destinationAddress: string, mapIndex?: number): Promise<string>;
    getBalance(server: string, sourceAddress: string, mapIndex?: number): Promise<string>;
    constructApprovalOperation(sourceAddress: string, destinationAddress: string, amount?: string, counter?: number, fee?: OperationFee): Transaction;
    matchApproveOperation(operation: any): OperationMatch;
}
