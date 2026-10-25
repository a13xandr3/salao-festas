/** Configura o ambiente Jest para executar os testes Angular sem Zone.js. */
import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

setupZonelessTestEnv();
