export interface OperationMatch {
    match: boolean;
    type: string;

    fee?: string;
    gas?: string;

    tokenBalance?: string; // sell
    coinMinimum?: string; // sell

    coinBalance?: string; // buy
    tokenMinimum?: string; // buy
}
