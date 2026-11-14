import { render } from 'preact';
import { ENV_NAMES } from '@birdsong/core';
render(<p>BirdSong dashboard skeleton. Environments: {ENV_NAMES.join(', ')}</p>, document.getElementById('app')!);
