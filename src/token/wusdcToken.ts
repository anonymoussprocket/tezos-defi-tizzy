import { BaseWrapToken } from '../types/types';

export class wusdcToken extends BaseWrapToken {
    constructor(tokenIndex: number = 17, tokenSymbol: string = 'wUSDC', tokenDecimals: number = 6) {
        super(tokenIndex, tokenSymbol, tokenDecimals);
    }
}
