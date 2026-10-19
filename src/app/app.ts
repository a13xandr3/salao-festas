import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Navbar } from "./components/navbar/navbar";
import { Presentation } from "./components/presentation/presentation";
import { TopSpaces } from "./components/top-spaces/top-spaces";
import { CelebrationArea } from "./components/celebration-area/celebration-area";
import { OurServices } from "./components/our-services/our-services";
import { Contact } from './components/contact/contact';
import { ReservationCalendar } from './components/reservation-calendar/reservation-calendar';
import { Footer } from './components/footer/footer';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Navbar, Presentation, TopSpaces, CelebrationArea, OurServices, Contact, ReservationCalendar, Footer],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('fed-salao');
}
