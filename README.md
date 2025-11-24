# Backend Coding Challenge

## Getting Started

This repository demonstrates a backend architecture that handles asynchronous tasks, workflows, and job execution using TypeScript, Express.js, and TypeORM. The project showcases how to:

- Define and manage entities such as `Task` and `Workflow`.
- Use a `WorkflowFactory` to create workflows from YAML configurations.
- Implement a `TaskRunner` that executes jobs associated with tasks and manages task and workflow states.
- Run tasks asynchronously using a background worker.

## Key Features

1. **Entity Modeling with TypeORM**

   - **Task Entity:** Represents an individual unit of work with attributes like `taskType`, `status`, `progress`, and references to a `Workflow`. 
   Furthermore, one Task entity could be preceded by another task.
   - **Workflow Entity:** Groups multiple tasks into a defined sequence or steps, allowing complex multi-step processes.
   Each workflow save the result in its `finalResult` attribute.

2. **Workflow Creation from YAML**

   - Use `WorkflowFactory` to load workflow definitions from a YAML file.
   - Dynamically create workflows and tasks without code changes by updating YAML files.

3. **Asynchronous Task Execution**

   - A background worker (`taskWorker`) continuously polls for `queued` tasks.
   - The `TaskRunner` runs the appropriate job based on a task’s `taskType`.

4. **Robust Status Management**

   - `TaskRunner` updates the status of tasks (from `queued` to `in_progress`, `completed`, `failed`).
   - Workflow status is evaluated after each task completes, ensuring you know when the entire workflow is `completed` or `failed`.

5. **Dependency Injection and Decoupling**
   - `TaskRunner` takes in only the `Task` and determines the correct job internally.
   - `TaskRunner` handles task state transitions, leaving the background worker clean and focused on orchestration.

## Project Structure

```
src
├─ models/
│   ├─ world_data.json  # Contains world data for analysis
│
├─ models/
│   ├─ Result.ts        # Defines the Result entity
│   ├─ Task.ts          # Defines the Task entity
│   ├─ Workflow.ts      # Defines the Workflow entity
│
├─ jobs/
│   ├─ Job.ts           # Job interface
│   ├─ JobFactory.ts    # getJobForTaskType function for mapping taskType to a Job
│   ├─ TaskRunner.ts    # Handles job execution & task/workflow state transitions
│   ├─ DataAnalysisJob.ts (example)
│   ├─ EmailNotificationJob.ts (example)
│   ├─ PolygonArea.ts
│   ├─ ReportGeneration.ts
│
├─ workflows/
│   ├─ WorkflowFactory.ts  # Creates workflows & tasks from a YAML definition
│
├─ workers/
│   ├─ taskWorker.ts    # Background worker that fetches queued tasks & runs them
│
├─ routes/
│   ├─ analysisRoutes.ts # POST /analysis endpoint to create workflows
│   ├─ workflowRoutes.ts # GET /:workflowID/status endpoint to get the current status; and /:workflowID/results to get the results of a completed workflow.
│
├─ data-source.ts       # TypeORM DataSource configuration
└─ index.ts             # Express.js server initialization & starting the worker
```

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- npm or yarn
- SQLite or another supported database

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/jehogo/backend-coding-challenge.git
   cd backend-coding-challenge
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure TypeORM:**

   - Edit `data-source.ts` to ensure the `entities` array includes `Task` and `Workflow` entities.
   - Confirm database settings (e.g. SQLite file path).

4. **Create or Update the Workflow YAML:**
   - Place a YAML file (e.g. `example_workflow.yml`) in a `workflows/` directory.
   - Define steps, for example:
     ```yaml
     name: "example_workflow"
     steps:
       - taskType: "analysis"
         stepNumber: 1
       - taskType: "notification"
         stepNumber: 2
      - taskType: "polygonArea"
         stepNumber: 3
      - taskType: "reportGeneration"
         stepNumber: 4
     ```

### Running the Application

1. **Compile TypeScript (optional if using `ts-node`):**

   ```bash
   npx tsc
   ```

2. **Start the server:**

   ```bash
   npm start
   ```

   If using `ts-node`, this will start the Express.js server and the background worker after database initialization.

3. **Create a Workflow (e.g. via `/analysis`):**

   


4. **Check Logs:**
   - The worker picks up tasks from `queued` state.
   - `TaskRunner` runs the corresponding job (e.g., data analysis, email notification) and updates states.
   - Once tasks are done, the workflow is marked as `completed`.

### **Available Functions**

Teh following tasks were developed for the coding challenge:

#### **Polygon area task**
This job is responsible for calculating the area of a polygon based on the GeoJSON data provided in the task.
The implementation is in the `src/jobs/PolygonAreaJob.ts` file and it's based on `@turf/area` library.
It only calculate the are for `Polygon` and `MultiPolygon` type data.

To use it configure the workflow YAML file and create the workflow via `/analysis` endpoint (already explained).

If there is a error with the used GeoJSON data, the job will fail and the task will be marked as `failed`.
The result will be saved in the task and showed in your console.


#### **Generate a report**

The `ReportGenerationJob` is responsible for generating a consolidated JSON report by aggregating the outputs of all tasks executed previously in the workflow.
The implementation can be found in: `src/jobs/ReportGenerationJob.ts`.

The job iterates through all tasks preceding it in the workflow and extracts the following data from each completed task: `taskId`, `type` and `output` (the result produced by the task). These are aggregated into a structured JSON report.

An example of the generated report structure:

   ```json
   {
     "workflowId": "<workflow-id>",
     "tasks": [
       {
         "taskId": "<task-id>",
         "type": "<task-type>",
         "output": "<task-result>"
       }
     ],
     "finalReport": "Task completed: <n>. Tasks with errors: <n>. Total tasks: <n>"
   }
   ```
The `finalReport` field provides a summary indicating:
- Number of successfully completed tasks
- Number of tasks that failed
- Total number of tasks processed

The report will only be generated if all preceding tasks have been completed (either successfully or with errors). 
If one or more preceding tasks are not completed, the job will fail and an error will be thrown. 
The error message will explicitly list the identifiers of the affected tasks so the workflow can be corrected or retried.

### **Available API**

This section describes the available endpoints to generate a workflow, query the status and results of a workflow.

#### **[POST] /analysis**

This will read the configured workflow YAML, create a workflow and tasks, and queue them for processing.

```bash
   curl -X POST http://localhost:3000/analysis \
   -H "Content-Type: application/json" \
   -d '{
    "clientId": "client123",
    "geoJson": {
        "type": "Polygon",
        "coordinates": [
            [
                [
                    -63.624885020050996,
                    -10.311050368263523
                ],
                [
                    -63.624885020050996,
                    -10.367865108370523
                ],
                [
                    -63.61278302732815,
                    -10.367865108370523
                ],
                [
                    -63.61278302732815,
                    -10.311050368263523
                ],
                [
                    -63.624885020050996,
                    -10.311050368263523
                ]
            ]
        ]
    }
    }'
   ```

#### **[GET] /workflow/:id/status**

Retrieve the current status of a workflow. This endpoint returns the execution status of the workflow, including how many tasks have completed, failed, and the total tasks.

This endpoint is intended to be used after triggering a workflow via the `/analysis` endpoint. 
Make sure you keep the workflow identifier printed in your console when the workflow starts.

**Example request**

```bash 
  curl -X GET "http://localhost:3000/workflow/<workflow-id>/status" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json"
```

**Successful response (200)**

 ```json
  {
    "workflowId": "<workflow-id>",
    "status": "<workflow-status>",
    "completedTasks": <total-completed-task>,
    "failedTasks:": <total-failed-task>,
    "totalTasks": <total-task>
  }
  ```

**Workflow not found (404)**
   ```json
   { 
      "message": "Workflow not found"
   }
   ```

#### **[GET] /workflow/:id/results**

Retrieve the final results of a completed workflow.
This endpoint returns the final output once all tasks in the workflow have been processed. 
If any tasks failed, the response will include the corresponding error information.

This endpoint is intended to be used after triggering a workflow via the `/analysis` endpoint. 
Make sure you keep the workflow identifier printed in your console when the workflow starts.

**Example request**

```bash 
curl -X GET "http://localhost:3000/workflow/<workflow-id>/results" \
-H "Accept: application/json" \
-H "Content-Type: application/json"
```

**Successful response (200)**

If all tasks has been completed successfully, the answer will be:

```json
  {
    "workflowId": "3433c76d-f226-4c91-afb5-7dfc7accab24",
    "status": "<status>",
    "finalResult": "Workflow finished with <n> task(s) completed."
  }
  ```

If all tasks has been completed at least one error, the answer will be:

```json
  {
    "workflowId": "3433c76d-f226-4c91-afb5-7dfc7accab24",
    "status": "completed",
    "finalResult": "Workflow finished with <n> task(s) completed and <n>> task(s) failed. Errors: <errors>."
  }
```
**Workflow Not Found (404)**

```json
  {
    "message": "Workflow not found"
  }
```

**Workflow Not Completed Yet (400)**

```json
  {
    "message": "Workflow is not completed yet"
  }
```


