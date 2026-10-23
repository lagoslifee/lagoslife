import { Component, type ReactNode } from "react";
import { report } from "../diagnostics";

type Props = {
  /** Where this guard sits, for the crash report. */
  area: string;
  children: ReactNode;
  /** Shown instead of the children while they are being rebuilt; nothing by default. */
  fallback?: ReactNode;
  /** Runs after a crash, before the children are rebuilt (close the panel that crashed, say). */
  onCrash?: (error: Error) => void;
  /** Shown for good after the first crash instead of rebuilding, for a part the screen can do without. */
  replacement?: ReactNode;
};

type State = { failures: number[]; generation: number; broken: boolean; message?: string };

/** Crashes inside a minute after which the guard stops rebuilding and offers a button instead. */
const LIMIT = 4;

/**
 * Catches a render error in part of the UI and rebuilds that part a moment later, so one broken panel never blanks the
 * whole game or needs a page reload. Repeated crashes in a short time stop the loop and show a small card.
 */
export class CrashGuard extends Component<Props, State> {
  state: State = { failures: [], generation: 0, broken: false };
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError() {
    return { broken: true };
  }

  componentDidCatch(error: Error) {
    const now = Date.now();
    const failures = [...this.state.failures.filter((at) => now - at < 60_000), now];
    report("ui-crash", `${this.props.area}: ${error.message}`.slice(0, 300), { stack: error.stack, detail: { message: error.message.slice(0, 190), name: error.name } });
    this.props.onCrash?.(error);
    this.setState({ failures, message: error.message.slice(0, 160) });
    if (failures.length >= LIMIT || this.props.replacement !== undefined) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rebuild(), 250);
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  private rebuild = () => this.setState((state) => ({ broken: false, generation: state.generation + 1 }));

  render() {
    if (!this.state.broken) return <GuardedChildren key={this.state.generation}>{this.props.children}</GuardedChildren>;
    if (this.props.replacement !== undefined) return this.props.replacement;
    if (this.state.failures.length < LIMIT) return this.props.fallback ?? null;
    return (
      <div className="crash-card" role="alert" data-testid={`crash-${this.props.area}`}>
        <p>This part of the game hit a problem. Your progress is saved.</p>
        {this.state.message && <p className="small muted">{this.state.message}</p>}
        <button className="primary" onClick={() => this.setState({ failures: [], broken: false, generation: this.state.generation + 1 })}>Reopen</button>
      </div>
    );
  }
}

function GuardedChildren({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
