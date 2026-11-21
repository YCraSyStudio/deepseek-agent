export interface IdGenerator {
  next(): string;
}

export interface GenerationEventSink<TEvent = unknown> {
  publish(event: TEvent): Promise<void> | void;
}
