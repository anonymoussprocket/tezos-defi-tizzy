import { BaseWrapToken } from '../types/types';

export class wmaticToken extends BaseWrapToken {
    constructor(tokenIndex: number = 11, tokenSymbol: string = 'wMATIC', tokenDecimals: number = 18) {
        super(tokenIndex, tokenSymbol, tokenDecimals);
    }
}
