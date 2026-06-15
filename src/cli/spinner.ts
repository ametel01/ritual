export type SpinnerHandle = {
  update(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
};

export type SpinnerFactory = {
  start(text: string): SpinnerHandle;
};

export type SpinnerOptions = {
  readonly stream?: NodeJS.WriteStream;
  readonly env?: SpinnerEnvironment;
};

type SpinnerEnvironment = Record<string, string | undefined> & {
  readonly CI?: string;
  readonly CLAUDE_CODE?: string;
  readonly CODEX_SANDBOX?: string;
  readonly TERM?: string;
};

const FRAMES = ["-", "\\", "|", "/"] as const;

export function createSpinnerFactory(options: SpinnerOptions = {}): SpinnerFactory {
  const stream = options.stream ?? process.stderr;
  const env = options.env ?? process.env;
  const enabled = isSpinnerInteractive(stream, env);

  return {
    start(text: string): SpinnerHandle {
      if (!enabled) {
        return noopSpinner();
      }
      return new TerminalSpinner(stream, text).start();
    },
  };
}

function isSpinnerInteractive(stream: NodeJS.WriteStream, env: SpinnerEnvironment): boolean {
  return (
    stream.isTTY === true &&
    env.CI === undefined &&
    env.CODEX_SANDBOX === undefined &&
    env.CLAUDE_CODE === undefined &&
    env.TERM !== "dumb" &&
    (stream.columns ?? 80) > 20
  );
}

function noopSpinner(): SpinnerHandle {
  return {
    update: () => undefined,
    succeed: () => undefined,
    fail: () => undefined,
    stop: () => undefined,
  };
}

class TerminalSpinner implements SpinnerHandle {
  private frameIndex = 0;
  private timer: NodeJS.Timeout | undefined;
  private text: string;
  private didFinalize = false;

  constructor(
    private readonly stream: NodeJS.WriteStream,
    text: string,
  ) {
    this.text = text;
  }

  start(): SpinnerHandle {
    this.render();
    this.timer = setInterval(() => this.render(), 80);
    this.timer.unref?.();
    return this;
  }

  update(text: string): void {
    if (this.didFinalize) {
      return;
    }
    this.text = text;
    this.render();
  }

  succeed(text = this.text): void {
    this.finalize(`ok ${text}`);
  }

  fail(text = this.text): void {
    this.finalize(`fail ${text}`);
  }

  stop(): void {
    if (this.didFinalize) {
      return;
    }
    this.didFinalize = true;
    this.clearTimer();
    this.clearLine();
  }

  private render(): void {
    if (this.didFinalize) {
      return;
    }
    const frame = FRAMES[this.frameIndex % FRAMES.length];
    this.frameIndex += 1;
    this.clearLine();
    this.stream.write(`${frame} ${this.text}`);
  }

  private finalize(text: string): void {
    if (this.didFinalize) {
      return;
    }
    this.didFinalize = true;
    this.clearTimer();
    this.clearLine();
    this.stream.write(`${text}\n`);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private clearLine(): void {
    this.stream.write("\r\x1b[2K");
  }
}
