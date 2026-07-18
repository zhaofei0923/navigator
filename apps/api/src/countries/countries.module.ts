import { Module } from "@nestjs/common";

import { CountriesController } from "./countries.controller.js";
import { CountriesService } from "./countries.service.js";

@Module({
  controllers: [CountriesController],
  providers: [CountriesService],
})
export class CountriesModule {}
