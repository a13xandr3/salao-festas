import { ChangeDetectionStrategy, Component } from '@angular/core';
import { version } from '../../../../package.json';

/** Exibe o rodapé com o ano atual e a versão do projeto. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-footer',
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
})
export class Footer {
  protected readonly year = new Date().getFullYear();
  protected readonly version = version;
}
