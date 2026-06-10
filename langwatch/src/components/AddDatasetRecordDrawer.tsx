/**
 * Component for adding records to a dataset through a drawer interface.
 * Allows users to select a dataset and map trace data to dataset columns.
 */

import { Button, HStack, Text, useDisclosure, VStack } from "@chakra-ui/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { useDrawer } from "~/hooks/useDrawer";
import { useLocalStorageSelectedDataSetId } from "~/hooks/useLocalStorageSelectedDataSetId";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "../server/datasets/types";
import type { MappingState } from "../server/tracer/tracesMapping";
import { AddOrEditDatasetDrawer } from "./AddOrEditDatasetDrawer";
import { DatasetMappingPreview } from "./datasets/DatasetMappingPreview";
import { DatasetSelector } from "./datasets/DatasetSelector";
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

  if (value.traceMapping) {
    return value.traceMapping;
  }

  if (value.mapping) {
    return {
      mapping: value.mapping,
      expansions: value.expansions ?? [],
    };
  }

  return undefined;
};

const traceMappingNeedsSpans = (mapping?: MappingState) => {
  if (!mapping) return false;

  if (
    mapping.expansions?.some((expansion) =>
      TRACE_EXPANSIONS_REQUIRING_SPANS.has(expansion),
    )
  ) {
    return true;
  }

  return Object.values(mapping.mapping ?? {}).some((entry) => {
    const source = entry?.source;
    if (sourceNeedsSpans(source)) return true;
    return entry?.selectedFields?.some(sourceNeedsSpans) ?? false;
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
  /** Time window the selected traces came from, used to bound ClickHouse reads. */
  selectedTraceTimeRange?: {
    from: number;
    to: number;
    live?: boolean;
  };
  /** Non-URL payload for bulk selections; avoids very long drawer URLs. */
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
  const { closeDrawer } = useDrawer();

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
      [
        ...(props.selectedTraceSelection?.traceIds ?? []),
        ...(Array.isArray(props.selectedTraceIds)
          ? props.selectedTraceIds
          : [props.selectedTraceIds]),
        props?.traceId ?? "",
      ].filter(Boolean) as string[],
    [
      props.selectedTraceIds,
      props.selectedTraceSelection?.traceIds,
      props.traceId,
    ],
  );

  // Fetch traces with spans data
  const tracesWithSpans = api.traces.getTracesWithSpans.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds: traceIds,
      timeRange: selectedTraceTimeRange,
      includeSpans: includeSpansForDataset,
    },
    {
      enabled: !!project && !!selectedDataset && traceIds.length > 0,
      refetchOnWindowFocus: false,
    },
  );

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
    closeDrawer();
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
          closeDrawer();
          toaster.create({
            title: "Succesfully added to dataset",
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
        <Drawer.Body overflow="visible" paddingX={0}>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <VStack paddingX={6}>
              <DatasetSelector
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
