import { Component, type ReactNode } from "react";

type DelayedRenderProps = {
  showing?: boolean;
  showDelay?: number;
  hideDelay?: number;
  children?: ReactNode;
};

class DelayedRender extends Component<
  DelayedRenderProps,
  { showing?: boolean }
> {
  timeoutId: number | undefined;

  constructor(props: DelayedRenderProps) {
    super(props);
    this.state = {
      showing: props.showing,
    };
  }

  componentDidUpdate(prevProps: DelayedRenderProps) {
    this.maybeUpdateState(prevProps, this.props);
  }

  componentWillUnmount() {
    window.clearTimeout(this.timeoutId);
  }

  maybeUpdateState(
    prevProps: DelayedRenderProps,
    currentProps: DelayedRenderProps,
  ) {
    if (!prevProps.showing && currentProps.showing) {
      window.clearTimeout(this.timeoutId);
      if (!this.props.showDelay) {
        this.setState({ showing: true });
      } else {
        this.timeoutId = window.setTimeout(
          () => this.setState({ showing: true }),
          this.props.showDelay,
        );
      }
    }
    if (prevProps.showing && !currentProps.showing) {
      window.clearTimeout(this.timeoutId);
      if (!this.props.hideDelay) {
        this.setState({ showing: false });
      } else {
        this.timeoutId = window.setTimeout(
          () => this.setState({ showing: false }),
          this.props.hideDelay,
        );
      }
    }
  }

  render() {
    return this.state.showing ? this.props.children : null;
  }
}

export default DelayedRender;
