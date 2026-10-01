import { Component, Fragment, type ReactNode } from "react";
import { Button } from "./Button";

/**
 * A render failure must never leave a blank popup (upstream #63, #1013): show a message and a
 * retry that remounts the subtree. Copy is passed in because hooks can't run in a class.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; message: string; retryLabel: string },
  { failed: boolean; attempt: number }
> {
  override state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="flex flex-col items-start gap-4 p-7">
          <p className="m-0 text-sm">{this.props.message}</p>
          <Button
            variant="outline"
            onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}
          >
            {this.props.retryLabel}
          </Button>
        </div>
      );
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
