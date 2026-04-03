/* eslint @typescript-eslint/no-explicit-any: 0 */
import { Component } from 'react';

class DelayedRender extends Component {
  timeoutId;

  constructor(props) {
    super(props);
    this.state = {
      showing: props.showing,
    };
  }

  componentDidUpdate(prevProps) {
    this.maybeUpdateState(prevProps, this.props);
  }

  componentWillUnmount() {
    window.clearTimeout(this.timeoutId);
  }

  maybeUpdateState(prevProps, currentProps) {
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