import { BaseWrapToken } from '../types/types';

export class wbusdToken extends BaseWrapToken {
    constructor(tokenIndex: number = 1, tokenSymbol: string = 'wBUSD', tokenDecimals: number = 8) {
        super(tokenIndex, tokenSymbol, tokenDecimals);
    }
}
