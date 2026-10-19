import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-top-spaces',
  templateUrl: './top-spaces.html',
  styleUrl: './top-spaces.scss',
})
export class TopSpaces {}
