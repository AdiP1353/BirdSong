import { render } from 'preact';
import { App } from './app.tsx';
import { connect } from './hubClient.ts';
import { installTooltips } from './tooltip.ts';
import './styles.css';

connect();
installTooltips();
render(<App />, document.getElementById('app')!);
