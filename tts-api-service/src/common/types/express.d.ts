/** Ambient augmentation of Express Request with auth + correlation context. */
import type { AuthUserContext } from './context.types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUserContext;
      correlationId?: string;
    }
  }
}

export {};
