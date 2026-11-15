import { render } from 'preact';
import { App } from './app.tsx';
import { Judge } from './components/Judge.tsx';
import { connect } from './hubClient.ts';
import './styles.css';

connect();
// ?view=judge is the phone page behind the dashboard's QR code.
const judge = new URLSearchParams(location.search).get('view') === 'judge';
if (judge) document.documentElement.classList.add('judge-page');
render(judge ? <Judge /> : <App />, document.getElementById('app')!);
