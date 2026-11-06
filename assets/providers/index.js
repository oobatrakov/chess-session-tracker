import * as chesscom from './chesscom.js';
import * as lichess from './lichess.js';

export const PROVIDERS = { chesscom, lichess };
export const PROVIDER_IDS = ['chesscom', 'lichess'];

export const PROVIDER_LABELS = {
  chesscom: 'Chess.com',
  lichess: 'Lichess',
};

export function getProvider(providerId) {
  return PROVIDERS[providerId] ?? PROVIDERS.chesscom;
}

export function otherProvider(providerId) {
  return providerId === 'lichess' ? 'chesscom' : 'lichess';
}
