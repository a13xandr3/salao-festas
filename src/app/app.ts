import { Gallery } from './components/gallery/gallery';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { Login } from './components/login/login';
import { afterNextRender, ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Navbar } from './components/navbar/navbar';
import { Presentation } from './components/presentation/presentation';
import { TopSpaces } from './components/top-spaces/top-spaces';
import { CelebrationArea } from './components/celebration-area/celebration-area';
import { OurServices } from './components/our-services/our-services';
import { Contact } from './components/contact/contact';
import { ReservationCalendar } from './components/reservation-calendar/reservation-calendar';
import { Footer } from './components/footer/footer';

/** Compõe o site público e alterna para a área restrita solicitada pela URL. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [
    RouterOutlet,
    Login,
    Navbar,
    Presentation,
    TopSpaces,
    CelebrationArea,
    OurServices,
    Contact,
    ReservationCalendar,
    Footer,
    Gallery,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly restricted = signal(false);
  private readonly document = inject(DOCUMENT);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);

  /** Identifica a área restrita e ajusta título e indexação após a renderização. */
  constructor() {
    afterNextRender(() => {
      if (new URLSearchParams(this.document.location.search).get('area') === 'restrita') {
        this.restricted.set(true);
        this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
        this.title.setTitle('Área restrita | Espaço TX');
      }
    });
  }
}
