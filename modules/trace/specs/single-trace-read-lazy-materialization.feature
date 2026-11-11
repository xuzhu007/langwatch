Feature: A single trace's summary and analytics rows are read eagerly

  The trace drawer header and the fold read-backs read one trace's latest row
  with ORDER BY ... LIMIT 1. ClickHouse 25.10 defers the non-sort columns of such
  a read to its lazy reader, and that reader misreads an Array column added by
  ALTER in a part written before the column existed: instead of the column's
  DEFAULT it decodes a garbage size and refuses with Code 173 ("Amount of memory
  requested to allocate is more than allowed (while reading column
  UnpricedModels) ... max_rows_to_read = 1"). An older trace then answers 500 in
  the drawer, and its fold read-back fails until the queue gives up on it.

  A full scan of the same column reads the DEFAULT correctly, so only the
  single-row reads opt out, the way the single-span reads already do
  (span-storage-read.feature).

  @unit
  Scenario: A single trace's summary is read without the lazy reader
    Given a trace whose summary is read back for the drawer header or a fold
    When the summary row is read
    Then the read turns lazy materialization off

  @unit
  Scenario: A single trace's analytics row is read back without the lazy reader
    Given a trace whose analytics row is read back for a fold
    When the latest version is read, with or without a fold window
    Then every read turns lazy materialization off
