import { Module } from '@nestjs/common';
import { MediaFetcherService } from './media-fetcher.service';

/** Non-HTTP sample services shared with the AI worker. */
@Module({
  providers: [MediaFetcherService],
  exports: [MediaFetcherService],
})
export class SamplesCoreModule {}
