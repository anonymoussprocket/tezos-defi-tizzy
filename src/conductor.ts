import fetch from 'node-fetch';
import * as log from 'loglevel';

import { registerFetch, registerLogger } from 'conseiljs';

import * as ethtzPlenty from '../config/ethtz-plenty';
// import * as tzbtcArthur from '../config/tzbtc-arthur';

function initConseil() {
    const logger = log.getLogger('conseiljs');
    logger.setLevel('error', false);
    registerLogger(logger);
    registerFetch(fetch);
}

async function start() {
    initConseil();
    // NOTE: account must be "revealed" before use
    // TODO: this instantiation is easy to screw up, there should be validation on init()

    const bots = [
        ...ethtzPlenty.initBotPair(),
        // ...tzbtcArthur.initBotPair()
    ];

    await Promise.all(bots.map(b => b.init()));
    await Promise.all(bots.map(b => b.run()));
}

start();
