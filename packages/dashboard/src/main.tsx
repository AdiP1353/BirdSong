import { render } from 'preact';
import { App } from './app.tsx';
import { connect } from './hubClient.ts';
import './styles.css';

connect();
render(<App />, document.getElementById('app')!);
