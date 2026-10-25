import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

/** Controla a abertura do menu de navegação do site. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-navbar',
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
})
export class Navbar {
  protected readonly menuOpen = signal(false);
}
