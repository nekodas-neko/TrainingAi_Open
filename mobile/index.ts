// First, so start-up timings (#3774) start as the bundle does.
import './src/core/reporting/start-clock';
import { registerRootComponent } from 'expo';
import './src/integrations/location/background-task';
import App from './App';

registerRootComponent(App);
