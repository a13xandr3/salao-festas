import { ChangeDetectionStrategy, Component } from '@angular/core';
import { version } from '../../../../package.json';

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
