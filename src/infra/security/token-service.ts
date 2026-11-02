import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type {
  AccessTokenClaims,
  TokenService,
} from '../../domain/identity/ports.js';
import type { UserRole } from '../../domain/shared/types.js';

export class JwtTokenService implements TokenService {
  async issueAccess(input: {
    userId: string;
    role: UserRole;
    passwordChangeOnly: boolean;
  }): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = env().ACCESS_TOKEN_TTL_SECONDS;
    const token = jwt.sign(
      { role: input.role, password_change_only: input.passwordChangeOnly },
      env().JWT_SECRET,
      {
        subject: input.userId,
        expiresIn,
        algorithm: 'HS256',
        jwtid: randomUUID(),
      },
    );
    return { token, expiresIn };
  }

  async verifyAccess(token: string): Promise<AccessTokenClaims> {
    const decoded = jwt.verify(token, env().JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) {
      throw new Error('Token inválido');
    }
    const payload = decoded as Record<string, unknown>;
    const sub = payload.sub;
    const role = payload.role;
    const iat = payload.iat;
    const exp = payload.exp;
    const jti = payload.jti;
    const passwordChangeOnly = payload.password_change_only;
    if (
      typeof sub !== 'string' ||
      typeof role !== 'string' ||
      typeof iat !== 'number' ||
      typeof exp !== 'number' ||
      typeof jti !== 'string' ||
      typeof passwordChangeOnly !== 'boolean'
    ) {
      throw new Error('Token inválido');
    }
    return {
      sub,
      role: role as UserRole,
      iat,
      exp,
      jti,
      password_change_only: passwordChangeOnly,
    };
  }

  generateRefresh(): { rawToken: string; tokenHash: string; familyId: string } {
    const rawToken = randomBytes(48).toString('base64url');
    return {
      rawToken,
      tokenHash: this.hashRefresh(rawToken),
      familyId: randomUUID(),
    };
  }

  hashRefresh(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
