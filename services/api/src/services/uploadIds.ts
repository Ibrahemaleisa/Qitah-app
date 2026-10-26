import { randomBytes } from 'node:crypto';

export const createId = () => `${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
