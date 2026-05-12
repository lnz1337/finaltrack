type Level = 'info' | 'warn' | 'error';

export interface StructuredLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createStructuredLogger(traceId: string, startedAt: number): StructuredLogger {
  function emit(level: Level, event: string, fields?: Record<string, unknown>) {
    // Campos do caller sobrescrevem primeiro; reservados são reaplicados depois pra
    // garantir que level/trace_id/elapsed_ms vêm do logger e não do caller.
    const payload = {
      ...(fields ?? {}),
      level,
      event,
      trace_id: traceId,
      elapsed_ms: Date.now() - startedAt,
    };
    console.error(JSON.stringify(payload));
  }

  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
