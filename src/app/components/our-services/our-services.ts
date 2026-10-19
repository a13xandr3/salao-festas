import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-our-services',
  templateUrl: './our-services.html',
  styleUrl: './our-services.scss',
})
export class OurServices {}
