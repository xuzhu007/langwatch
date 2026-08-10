/**
 * Component for adding records to a dataset through a drawer interface.
 * Allows users to select a dataset and map trace data to dataset columns.
 */

import { Button, HStack, Text, useDisclosure, VStack } from "@chakra-ui/react";
import { createLogger } from "@langwatch/observability";
import { useEffect, useMemo, useRef, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { useAnnotationQueueSessionStore } from "~/features/traces-v2/stores/annotationQueueSessionStore";
import { useDrawer } from "~/hooks/useDrawer";
import { useLocalStorageSelectedDataSetId } from "~/hooks/useLocalStorageSelectedDataSetId";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "../server/datasets/types";
import type { MappingState } from "../server/tracer/tracesMapping";
import { AddOrEditDatasetDrawer } from "./AddOrEditDatasetDrawer";
import { DatasetMappingPreview } from "./datasets/DatasetMappingPreview";
import { DatasetSelector } from "./datasets/DatasetSelector";
import { traceBatching } from "./traces/traceBatching";
import { Drawer } from "./ui/drawer";
import { Link } from "./ui/link";
import { toaster } from "./ui/toaster";

const logger = createLogger("AddDatasetRecordDrawer");
const TRACE_SOURCES_REQUIRING_SPANS = new Set([
  "contexts",
  "contexts.string_list",
  "events",
  "spans",
  "spans.llm.input",
  "spans.llm.output",
]);
const TRACE_EXPANSIONS_REQUIRING_SPANS = new Set([
  "events.event_id",
  "spans.all.span_id",
  "spans.llm.span_id",
]);
const DEFAULT_COLUMN_NAMES_REQUIRING_SPANS = new Set(["contexts", "spans"]);

const sourceNeedsSpans = (source?: string) =>
  !!source &&
  (TRACE_SOURCES_REQUIRING_SPANS.has(source) || source.startsWith("spans."));

const getDatasetTraceMapping = (mapping: unknown): MappingState | undefined => {
  if (!mapping || typeof mapping !== "object") return undefined;

  const value = mapping as {
    traceMapping?: MappingState;
    mapping?: MappingState["mapping"];
    expansions?: MappingState["expansions"];
  };

  if (value.traceMapping) return value.traceMapping;
  if (!value.mapping) return undefined;

  return {
    mapping: value.mapping,
    expansions: value.expansions ?? [],
  };
};

const traceMappingNeedsSpans = (mapping?: MappingState) => {
  if (!mapping) return false;

  if (
    mapping.expansions.some((expansion) =>
      TRACE_EXPANSIONS_REQUIRING_SPANS.has(expansion),
    )
  ) {
    return true;
  }

  return Object.values(mapping.mapping).some((entry) => {
    if (sourceNeedsSpans(entry.source)) return true;
    return entry.selectedFields?.some(sourceNeedsSpans) ?? false;
  });
};

const unmappedDefaultColumnsNeedSpans = (
  columnTypes: DatasetColumns | undefined,
  mapping?: MappingState,
) => {
  const mappedColumns = new Set(Object.keys(mapping?.mapping ?? {}));
  return (
    columnTypes?.some(
      ({ name }) =>
        !mappedColumns.has(name) &&
        DEFAULT_COLUMN_NAMES_REQUIRING_SPANS.has(name),
    ) ?? false
  );
};

/** Form values for dataset selection */
type FormValues = {
  datasetId: string;
};

/** Props for the AddDatasetRecordDrawer component */
interface AddDatasetDrawerProps {
  /** Callback function called on successful record addition */
  onSuccess?: () => void;
  /** ID of the trace to add */
  traceId?: string;
  /** Array of trace IDs to add */
  selectedTraceIds?: string[] | string;
  /** 所选 trace 的时间范围，用于限制 ClickHouse 查询。 */
  selectedTraceTimeRange?: {
    from: number;
    to: number;
    live?: boolean;
  };
  /** 批量选择的内存态参数，避免把大量 ID 写入 URL。 */
  selectedTraceSelection?: {
    traceIds: string[];
    timeRange?: {
      from: number;
      to: number;
      live?: boolean;
    };
  };
}

/**
 * Drawer component for adding records to a dataset
 * @param props - Component props
 */
export function AddDatasetRecordDrawerV2(props: AddDatasetDrawerProps) {
  const trpc = api.useContext();
  const { project } = useOrganizationTeamProject();
  const createDatasetRecord = api.datasetRecord.create.useMutation();
  const editDataset = useDisclosure();
  // Leaving this drawer hands the reader back to whatever opened it, the
  // trace they were reading say, rather than clearing the page. Opened with
  // nothing underneath (a bulk selection, the end-of-queue hand-off), going
  // back closes the drawer outright.
  const { goBack } = useDrawer();

  // Selected Dataset ID - Local Storage
  const {
    selectedDataSetId: localStorageDatasetId,
    setSelectedDataSetId: setLocalStorageDatasetId,
  } = useLocalStorageSelectedDataSetId();

  // Form Hook
  const {
    handleSubmit,
    reset,
    watch,
    formState: { errors },
    setValue,
  } = useForm<FormValues>({
    defaultValues: {
      datasetId: localStorageDatasetId,
    },
  });

  const datasetId = watch("datasetId");
  // Fetch all datasets for the project
  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project, refetchOnWindowFocus: false },
  );
  const selectedTraceTimeRange =
    props.selectedTraceSelection?.timeRange ?? props.selectedTraceTimeRange;

  const selectedDataset = datasets.data?.find(
    (dataset) => dataset.id === datasetId,
  );
  const columnTypes = selectedDataset?.columnTypes as
    | DatasetColumns
    | undefined;
  const [traceMappingOverride, setTraceMappingOverride] = useState<
    MappingState | undefined
  >();
  const savedTraceMapping = useMemo(
    () => getDatasetTraceMapping(selectedDataset?.mapping),
    [selectedDataset?.mapping],
  );
  const includeSpansForDataset = useMemo(() => {
    const mapping = traceMappingOverride ?? savedTraceMapping;
    return (
      traceMappingNeedsSpans(mapping) ||
      unmappedDefaultColumnsNeedSpans(columnTypes, mapping)
    );
  }, [columnTypes, savedTraceMapping, traceMappingOverride]);

  useEffect(() => {
    setTraceMappingOverride(undefined);
  }, [selectedDataset?.id]);

  // Combine trace IDs from props into a single array
  const traceIds = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...(props.selectedTraceSelection?.traceIds ?? []),
            ...(Array.isArray(props.selectedTraceIds)
              ? props.selectedTraceIds
              : [props.selectedTraceIds]),
            props?.traceId ?? "",
          ].filter(Boolean) as string[],
        ),
      ),
    [
      props.selectedTraceIds,
      props.selectedTraceSelection?.traceIds,
      props.traceId,
    ],
  );

  // tRPC 查询通过 GET 传参，批量 ID 必须拆分，避免单次请求超过 URL 上限。
  const traceIdChunks = useMemo(
    () => traceBatching.chunkTraceIds(traceIds),
    [traceIds],
  );
  // withEditOverlay: reviewer 修正在此应用，保证数据集记录携带修正后的内容。
  const traceQueries = api.useQueries((trpc) =>
    traceIdChunks.map((traceIdChunk) =>
      trpc.traces.getTracesWithSpans(
        {
          projectId: project?.id ?? "",
          traceIds: traceIdChunk,
          timeRange: selectedTraceTimeRange,
          includeSpans: includeSpansForDataset,
          withEditOverlay: true,
        },
        {
          enabled: !!project && !!selectedDataset,
          refetchOnWindowFocus: false,
        },
      ),
    ),
  );
  const tracesWithSpans = useMemo(() => {
    const data = traceQueries.every((query) => query.data !== undefined)
      ? traceBatching.mergeTraceBatches(
          traceIds,
          traceQueries.map((query) => query.data),
        )
      : undefined;

    return {
      data,
      isLoading: traceQueries.some((query) => query.isLoading),
      isError: traceQueries.some((query) => query.isError),
    };
  }, [traceIds, traceQueries]);

  /**
   * Handle successful dataset creation
   * @param datasetId - ID of the newly created dataset
   */
  const onCreateDatasetSuccess = ({ datasetId }: { datasetId: string }) => {
    // editDataset.onClose(); // not needed since it will automatically close
    void datasets
      .refetch()
      .then(() => {
        setTimeout(() => {
          setValue("datasetId", datasetId);
        }, 100);
      })
      .catch((error) => {
        logger.error({ error });
      });
  };

  /**
   * Handle drawer close
   */
  const handleOnClose = () => {
    goBack();
    reset();
  };

  // State for editable row data
  const [editableRowData, setEditableRowData] = useState<DatasetRecordEntry[]>(
    [],
  );
  const rowsToAdd = editableRowData.filter((row) => row.selected);

  /**
   * Handle form submission
   * @param _data - Form data
   */
  const onSubmit: SubmitHandler<FormValues> = async (_data) => {
    if (!selectedDataset || !project) return;

    // Transform row data into dataset entries
    const entries: DatasetRecordEntry[] = rowsToAdd.map(
      (row) =>
        Object.fromEntries(
          Object.entries(row)
            .filter(([key, _]) => key !== "selected")
            .map(([key, value]) => {
              const column = columnTypes?.find((column) => column.name === key);
              let entry: DatasetRecordEntry = value;
              if (column?.type !== "string") {
                try {
                  entry = JSON.parse(value as string);
                } catch {
                  /* this is just a safe json parse fallback */
                }
              }

              return [key, entry];
            }),
        ) as DatasetRecordEntry,
    );

    // Create dataset records
    await createDatasetRecord.mutateAsync(
      {
        projectId: project.id ?? "",
        datasetId: datasetId,
        entries,
      },
      {
        onSuccess: () => {
          trpc.dataset.getAll.invalidate();
          trpc.datasetRecord.getAll.invalidate();
          // Whoever opened the drawer gets told the records landed, so a flow
          // that led here can finish itself off.
          props.onSuccess?.();
          // The annotation queue's hand-off is the one flow whose next step
          // outlives this drawer: the walk is over, and the celebration it
          // crowns waits on the records actually landing.
          const session = useAnnotationQueueSessionStore.getState();
          if (session.active) session.noteHandoffAdded();
          goBack();
          toaster.create({
            title: "Successfully added to dataset",
            description: (
              <Link
                colorPalette="white"
                textDecoration={"underline"}
                href={`/${project?.slug}/datasets/${datasetId}`}
                isExternal={false}
              >
                View the dataset
              </Link>
            ),
            type: "success",
            meta: {
              closable: true,
            },
          });
        },
        onError: () => {
          toaster.create({
            title: "Failed to add to the dataset",
            description:
              "Please check if the rows were not already inserted in the dataset",
            type: "error",
            meta: {
              closable: true,
            },
          });
        },
      },
    );

    // We do this here since if we do it before, or attempt to do keep the
    // datasetId in sync, it will force a re-render and the drawers will close.
    await setLocalStorageDatasetId(_data.datasetId);
  };

  // State for row data from dataset
  const [rowDataFromDataset, setRowDataFromDataset] = useState<
    DatasetRecordEntry[]
  >([]);

  // Update editable row data when dataset row data changes
  useEffect(() => {
    if (!rowDataFromDataset) return;

    setEditableRowData(rowDataFromDataset);
  }, [rowDataFromDataset]);

  // Scroll position tracking
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorPortalRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(false);

  // Update scroll position state
  useEffect(() => {
    if (!scrollRef.current) return;

    setAtBottom(
      (scrollRef.current.scrollTop ?? 0) >=
        (scrollRef.current.scrollHeight ?? 0) -
          (scrollRef.current.clientHeight ?? 0),
    );
  }, [rowDataFromDataset]);

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="xl"
      onOpenChange={({ open }) => {
        if (!open) {
          handleOnClose();
        }
      }}
      onEscapeKeyDown={(e) => {
        // Escape while the floating cell editor is open should only close
        // the editor (its own handler), never the whole drawer.
        if (
          editorPortalRef.current?.querySelector("[data-floating-cell-editor]")
        ) {
          e.preventDefault();
        }
      }}
      preventScroll={true}
    >
      <Drawer.Content
        bg="bg"
        maxWidth="1400px"
        overflow="auto"
        ref={scrollRef}
        onScroll={() =>
          setAtBottom(
            (scrollRef.current?.scrollTop ?? 0) >=
              (scrollRef.current?.scrollHeight ?? 0) -
                (scrollRef.current?.clientHeight ?? 0),
          )
        }
      >
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="3xl">
              Add to Dataset
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body overflow="visible" paddingX={0} ref={editorPortalRef}>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <VStack paddingX={6}>
              <DatasetSelector
                isLoading={datasets.isLoading}
                isError={datasets.isError}
                datasets={datasets.data}
                localStorageDatasetId={datasetId}
                errors={errors}
                setValue={setValue}
                onCreateNew={editDataset.onOpen}
              />
              {selectedDataset && (
                <DatasetMappingPreview
                  traces={tracesWithSpans.data ?? []}
                  columnTypes={selectedDataset.columnTypes as DatasetColumns}
                  rowData={rowDataFromDataset}
                  selectedDataset={selectedDataset}
                  onEditColumns={editDataset.onOpen}
                  onRowDataChange={setRowDataFromDataset}
                  editorPortalRef={editorPortalRef}
                  setDatasetTriggerMapping={setTraceMappingOverride}
                />
              )}
            </VStack>

            <HStack
              width="full"
              justifyContent="flex-end"
              position="sticky"
              bottom={0}
              paddingBottom={4}
              background="bg.panel"
              transition="box-shadow 0.3s ease-in-out"
              boxShadow={atBottom ? "none" : "0 -2px 5px rgba(0, 0, 0, 0.1)"}
              paddingX={6}
            >
              <Button
                type="submit"
                colorPalette="blue"
                marginTop={6}
                marginBottom={4}
                loading={createDatasetRecord.isLoading}
                disabled={
                  !selectedDataset ||
                  !tracesWithSpans.data ||
                  rowsToAdd.length === 0
                }
              >
                Add{" "}
                {selectedDataset && tracesWithSpans.data
                  ? `${rowsToAdd.length} ${
                      rowsToAdd.length == 1 ? "row" : "rows"
                    }`
                  : ""}{" "}
                to dataset
              </Button>
            </HStack>
          </form>
        </Drawer.Body>
      </Drawer.Content>
      <AddOrEditDatasetDrawer
        datasetToSave={
          selectedDataset
            ? {
                datasetId,
                name: selectedDataset?.name ?? "",
                datasetRecords: undefined,
                columnTypes:
                  (selectedDataset?.columnTypes as DatasetColumns) ?? [],
              }
            : undefined
        }
        open={editDataset.open}
        onClose={editDataset.onClose}
        onSuccess={onCreateDatasetSuccess}
      />
    </Drawer.Root>
  );
}
