import { SpotCategory } from '../constants/spot';

export interface Spot {
  id: string;
  name: string;
  category: SpotCategory;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  price: number;
  open_time: string;
  tags: string[];
  image: string;
}

