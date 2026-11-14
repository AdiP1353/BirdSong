import { render } from 'preact';
import { ENV_NAMES } from '@birdsong/core';
render(<p>BirdSong web skeleton. Environments: {ENV_NAMES.join(', ')}</p>, document.getElementById('app')!);
