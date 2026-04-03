import { useState } from 'react';
import StartSetup from './StartSetup';
import ConnectionLost from './ConnectionLost';

const Setup = ({ systemScreen }) => {
  if (systemScreen === 'auth') {
    return <StartSetup />;
  }

  if (systemScreen === 'connectionLost') {
    return <ConnectionLost />;
  }

  return <StartSetup />;
};

export default Setup;
