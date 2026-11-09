/**
 * Zod 4 probes `Function('')` to decide whether it may compile fast parsers. Extension pages
 * forbid eval (MV3 Content Security Policy), so the probe is blocked and Chrome reports a CSP
 * issue each time. `jitless` skips the probe; parsing is unchanged. Import this first in
 * every entrypoint, before any schema is used.
 */
import { z } from 'zod';

z.config({ jitless: true });
