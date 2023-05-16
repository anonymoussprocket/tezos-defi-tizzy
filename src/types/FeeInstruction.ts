export interface FeeInstruction {
    instruction: 'None' | 'Bid' | 'Replace' | 'Skip';
    fee: number;
}
