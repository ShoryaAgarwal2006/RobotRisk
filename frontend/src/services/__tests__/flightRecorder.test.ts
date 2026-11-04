import { describe, it, expect, beforeEach } from 'vitest';
import {
  FlightRecorderService,
  MAX_FRAMES_PER_SESSION,
  MAX_RETAINED_SESSIONS,
} from '../flightRecorder';
import { RobotPose, SensorData } from '../../types/simulation';

describe('Phase 5.3B: Black Box Flight Recorder & Telemetry System', () => {
  let recorder: FlightRecorderService;

  const mockRobotPose: RobotPose = {
    position: [1.25, 0.22, 3.45],
    rotation: 1.5708,
    linearVelocity: 1.85,
    angularVelocity: 0.12,
  };

  const mockSensorData: SensorData = {
    forwardDist: 3.2,
    leftDist: 2.1,
    rightDist: 2.4,
    riskLevel: 'clear',
    closestObstacle: 'Storage Rack',
    ttc: 4.2,
    minClearance: 1.6,
    safetyStatus: 'SAFE',
    highestRiskObstacle: 'Storage Rack',
    isCollisionCourse: false,
  };

  beforeEach(() => {
    recorder = new FlightRecorderService();
    recorder.clearAllSessions();
  });

  describe('1. Recording Lifecycle: Start, Stop and Session Management', () => {
    it('initializes in idle state with no active session', () => {
      expect(recorder.getIsRecording()).toBe(false);
      expect(recorder.getCurrentSession()).toBeNull();
      expect(recorder.getAllSessions()).toHaveLength(0);
    });

    it('starts a new flight recording session with correct metadata', () => {
      const session = recorder.startRecording(0.0, true, 'operator', 'RR-TEST-ROOM');

      expect(recorder.getIsRecording()).toBe(true);
      expect(session).not.toBeNull();
      expect(session.recordingId).toMatch(/^REC-/);
      expect(session.sessionId).toBe('RR-TEST-ROOM');
      expect(session.isAuthoritative).toBe(true);
      expect(session.userRole).toBe('operator');
      expect(session.startTimeSim).toBe(0.0);
      expect(session.isCompleted).toBe(false);
      expect(session.frames).toHaveLength(0);
      expect(session.incidents).toHaveLength(0);
    });

    it('stops recording and archives session into history', () => {
      recorder.startRecording(0.0, true, 'operator');
      recorder.sampleFrame(0.1, mockRobotPose, 'MOVING', mockSensorData);

      const stopped = recorder.stopRecording(1.5);

      expect(recorder.getIsRecording()).toBe(false);
      expect(recorder.getCurrentSession()).toBeNull();
      expect(stopped).not.toBeNull();
      expect(stopped!.isCompleted).toBe(true);
      expect(stopped!.endTimeSim).toBe(1.5);
      expect(recorder.getPastSessions()).toHaveLength(1);
    });

    it('enforces bounded session retention limit of max 5 sessions', () => {
      // Start and stop 7 consecutive sessions
      for (let i = 0; i < 7; i++) {
        recorder.startRecording(i * 10, true, 'operator');
        recorder.sampleFrame(i * 10 + 0.1, mockRobotPose, 'MOVING', mockSensorData);
        recorder.stopRecording(i * 10 + 5);
      }

      const past = recorder.getPastSessions();
      expect(past.length).toBeLessThanOrEqual(MAX_RETAINED_SESSIONS);
      expect(past.length).toBe(5);
    });
  });

  describe('2. 10 Hz Deterministic Telemetry Sampling', () => {
    it('captures frames when simTime advances by >= 0.10s', () => {
      recorder.startRecording(0.0, true, 'operator');

      // Sample 1: at t = 0.0s -> Captured
      const s1 = recorder.sampleFrame(0.0, mockRobotPose, 'MOVING', mockSensorData);
      expect(s1).toBe(true);

      // Sample 2: at t = 0.04s (< 0.10s delta) -> Skipped
      const s2 = recorder.sampleFrame(0.04, mockRobotPose, 'MOVING', mockSensorData);
      expect(s2).toBe(false);

      // Sample 3: at t = 0.08s (< 0.10s delta) -> Skipped
      const s3 = recorder.sampleFrame(0.08, mockRobotPose, 'MOVING', mockSensorData);
      expect(s3).toBe(false);

      // Sample 4: at t = 0.10s (>= 0.10s delta) -> Captured
      const s4 = recorder.sampleFrame(0.10, mockRobotPose, 'MOVING', mockSensorData);
      expect(s4).toBe(true);

      // Sample 5: at t = 0.20s -> Captured
      const s5 = recorder.sampleFrame(0.20, mockRobotPose, 'MOVING', mockSensorData);
      expect(s5).toBe(true);

      const session = recorder.getCurrentSession();
      expect(session!.frames).toHaveLength(3);
    });

    it('correctly maps all telemetry fields in captured frames', () => {
      recorder.startRecording(12.5, true, 'operator');
      recorder.sampleFrame(12.5, mockRobotPose, 'MOVING', mockSensorData);

      const frame = recorder.getCurrentSession()!.frames[0];
      expect(frame.simTime).toBe(12.5);
      expect(frame.wallTime).toBeGreaterThan(0);
      expect(frame.position).toEqual([1.25, 0.22, 3.45]);
      expect(frame.linearVelocity).toBe(1.85);
      expect(frame.angularVelocity).toBe(0.12);
      expect(frame.navState).toBe('MOVING');
      expect(frame.ttc).toBe(4.2);
      expect(frame.minClearance).toBe(1.6);
      expect(frame.safetyStatus).toBe('SAFE');
      expect(frame.highestRiskObstacle).toBe('Storage Rack');
      expect(frame.isCollisionCourse).toBe(false);
      expect(frame.lidar.forward).toBe(3.2);
    });
  });

  describe('3. Circular Ring Buffer Bound (10,000 Frames)', () => {
    it('maintains strict 10,000 frames cap with circular FIFO wraparound', () => {
      recorder.startRecording(0.0, true, 'operator');

      const session = recorder.getCurrentSession()!;

      // Directly fill buffer to 10,000 frames
      for (let i = 0; i < MAX_FRAMES_PER_SESSION; i++) {
        session.frames.push({
          simTime: i * 0.1,
          wallTime: Date.now() + i,
          position: [0, 0, i],
          rotation: 0,
          linearVelocity: 1,
          angularVelocity: 0,
          navState: 'MOVING',
          ttc: null,
          minClearance: 2.0,
          safetyStatus: 'SAFE',
          highestRiskObstacle: null,
          isCollisionCourse: false,
          activeObstaclesCount: 0,
          lidar: { forward: 5, left: 3, right: 3 },
        });
      }
      session.totalFramesSampled = MAX_FRAMES_PER_SESSION;

      expect(session.frames).toHaveLength(10000);
      expect(session.frames[0].position[2]).toBe(0);

      // Now push 1 extra frame past the 10,000 limit via sampleFrame
      recorder.sampleFrame(1001.0, mockRobotPose, 'MOVING', mockSensorData);

      expect(session.frames).toHaveLength(10000);
      expect(session.hasBufferWrapped).toBe(true);
      expect(session.totalFramesSampled).toBe(10001);
      // Verify oldest frame was dropped and new frame was appended
      expect(session.frames[session.frames.length - 1].simTime).toBe(1001.0);
    });
  });

  describe('4. Event-Driven Incident Capture & Exact-Time Telemetry Snapshot', () => {
    it('immediately logs incidents with exact-time telemetry snapshot even between 10 Hz ticks', () => {
      recorder.startRecording(5.0, true, 'operator');

      // Sample frame at 5.0s
      recorder.sampleFrame(5.0, mockRobotPose, 'MOVING', mockSensorData);

      // Critical collision occurs at t = 5.03s (only 30ms after, between 100ms sample ticks)
      const incident = recorder.recordIncident(
        'COLLISION',
        'Physical impact with Concrete Pillar! Force: 45.2 N',
        5.03,
        mockRobotPose,
        'STOPPED',
        { ...mockSensorData, safetyStatus: 'CRITICAL', minClearance: 0.0 },
        [],
        [],
        { impulse: 45.2, obstacle: 'Concrete Pillar' }
      );

      expect(incident).not.toBeNull();
      expect(incident!.type).toBe('COLLISION');
      expect(incident!.simTime).toBe(5.03);
      expect(incident!.snapshot).toBeDefined();
      expect(incident!.snapshot.simTime).toBe(5.03);
      expect(incident!.snapshot.navState).toBe('STOPPED');
      expect(incident!.snapshot.minClearance).toBe(0.0);
      expect(incident!.details?.impulse).toBe(45.2);

      // Incident is stored in session
      const session = recorder.getCurrentSession()!;
      expect(session.incidents).toHaveLength(1);
      expect(session.incidents[0].type).toBe('COLLISION');
    });

    it('automatically detects state transitions: TTC Critical, Warning, Emergency Braking, and Route Blocked', () => {
      recorder.startRecording(0.0, true, 'operator');

      // Step 1: Normal cruising (SAFE)
      recorder.sampleFrame(0.0, mockRobotPose, 'MOVING', mockSensorData);
      expect(recorder.getCurrentSession()!.incidents).toHaveLength(0);

      // Step 2: Transition to TTC Warning at t = 0.10s
      const warningSensor = { ...mockSensorData, safetyStatus: 'WARNING' as const, ttc: 2.8 };
      recorder.sampleFrame(0.10, mockRobotPose, 'MOVING', warningSensor);
      expect(recorder.getCurrentSession()!.incidents.some((i) => i.type === 'TTC_WARNING')).toBe(true);

      // Step 3: Transition to TTC Critical and Emergency Braking at t = 0.20s
      const criticalSensor = { ...mockSensorData, safetyStatus: 'CRITICAL' as const, ttc: 1.2, minClearance: 0.35 };
      recorder.sampleFrame(0.20, mockRobotPose, 'AVOIDING', criticalSensor, [], [], {
        brakingStatus: 'emergency_braking',
        routeValidity: 'blocked',
      });

      const incidents = recorder.getCurrentSession()!.incidents;
      expect(incidents.some((i) => i.type === 'TTC_CRITICAL')).toBe(true);
      expect(incidents.some((i) => i.type === 'EMERGENCY_BRAKING')).toBe(true);
      expect(incidents.some((i) => i.type === 'ROUTE_BLOCKED')).toBe(true);
    });

    it('deduplicates persistent state (does not spam incidents when condition persists unchanged)', () => {
      recorder.startRecording(0.0, true, 'operator');

      const criticalSensor = { ...mockSensorData, safetyStatus: 'CRITICAL' as const, ttc: 1.1, minClearance: 0.3 };

      // Frame 1: Transition into CRITICAL -> Triggers incident
      recorder.sampleFrame(0.10, mockRobotPose, 'AVOIDING', criticalSensor);
      const count1 = recorder.getCurrentSession()!.incidents.filter((i) => i.type === 'TTC_CRITICAL').length;
      expect(count1).toBe(1);

      // Frame 2: Still CRITICAL on next frame -> Should NOT create duplicate incident
      recorder.sampleFrame(0.20, mockRobotPose, 'AVOIDING', criticalSensor);
      const count2 = recorder.getCurrentSession()!.incidents.filter((i) => i.type === 'TTC_CRITICAL').length;
      expect(count2).toBe(1);

      // Frame 3: Still CRITICAL on subsequent frame -> Should NOT create duplicate incident
      recorder.sampleFrame(0.30, mockRobotPose, 'AVOIDING', criticalSensor);
      const count3 = recorder.getCurrentSession()!.incidents.filter((i) => i.type === 'TTC_CRITICAL').length;
      expect(count3).toBe(1);
    });
  });

  describe('5. Simulation Pause & Reset Handling', () => {
    it('does not record artificial frames while simulation clock is paused (simTime frozen)', () => {
      recorder.startRecording(10.0, true, 'operator');

      // Sample at 10.0s
      recorder.sampleFrame(10.0, mockRobotPose, 'MOVING', mockSensorData);
      expect(recorder.getCurrentSession()!.frames).toHaveLength(1);

      // Simulation is paused for multiple render frames -> simTime stays 10.0s
      recorder.sampleFrame(10.0, mockRobotPose, 'MOVING', mockSensorData);
      recorder.sampleFrame(10.0, mockRobotPose, 'MOVING', mockSensorData);
      recorder.sampleFrame(10.0, mockRobotPose, 'MOVING', mockSensorData);

      // Frame count must remain 1! Zero artificial duplicate frames generated during pause
      expect(recorder.getCurrentSession()!.frames).toHaveLength(1);

      // Simulation resumes and advances to 10.15s -> Samples new frame
      recorder.sampleFrame(10.15, mockRobotPose, 'MOVING', mockSensorData);
      expect(recorder.getCurrentSession()!.frames).toHaveLength(2);
    });
  });

  describe('6. Multiplayer Authority Distinction', () => {
    it('labels authoritative sessions correctly for Host Operator', () => {
      const sess = recorder.startRecording(0.0, true, 'operator', 'RR-ALPHA-12');
      expect(sess.isAuthoritative).toBe(true);
      expect(sess.userRole).toBe('operator');
    });

    it('labels remote mirror sessions correctly for Scenario Controller', () => {
      const sess = recorder.startRecording(0.0, false, 'controller', 'RR-ALPHA-12');
      expect(sess.isAuthoritative).toBe(false);
      expect(sess.userRole).toBe('controller');
    });
  });

  describe('7. Data Export Verification: JSON and CSV', () => {
    it('generates valid JSON export containing metadata, incidents with snapshots, and telemetry frames', () => {
      recorder.startRecording(0.0, true, 'operator', 'RR-TEST-EXP');
      recorder.sampleFrame(0.0, mockRobotPose, 'MOVING', mockSensorData);
      recorder.sampleFrame(0.1, mockRobotPose, 'MOVING', mockSensorData);
      recorder.recordIncident('COLLISION', 'Impact detected', 0.15, mockRobotPose, 'STOPPED', mockSensorData);
      const session = recorder.stopRecording(1.0)!;

      const jsonStr = recorder.exportSessionAsJSON(session);
      expect(jsonStr).toBeTypeOf('string');

      const parsed = JSON.parse(jsonStr);
      expect(parsed.format).toBe('RobotRisk-FlightRecorder-v1');
      expect(parsed.metadata.recordingId).toBe(session.recordingId);
      expect(parsed.metadata.isAuthoritative).toBe(true);
      expect(parsed.metadata.durationSimSeconds).toBe(1.0);
      expect(parsed.incidentSummary.collisions).toBe(1);
      expect(parsed.incidents).toHaveLength(1);
      expect(parsed.incidents[0].snapshot.simTime).toBe(0.15);
      expect(parsed.telemetryFrames).toHaveLength(3); // 2 sample frames + 1 instant incident snapshot frame
    });

    it('generates valid RFC 4180 CSV export with proper headers and data rows', () => {
      recorder.startRecording(0.0, true, 'operator');
      recorder.sampleFrame(0.0, mockRobotPose, 'MOVING', mockSensorData);
      recorder.sampleFrame(0.1, mockRobotPose, 'MOVING', mockSensorData);
      const session = recorder.stopRecording(0.5)!;

      const csvStr = recorder.exportSessionAsCSV(session);
      expect(csvStr).toBeTypeOf('string');

      const lines = csvStr.split('\n');
      expect(lines.length).toBe(3); // 1 header + 2 data rows

      const header = lines[0];
      expect(header).toContain('sim_time_sec');
      expect(header).toContain('linear_velocity_mps');
      expect(header).toContain('ttc_sec');
      expect(header).toContain('min_clearance_m');
      expect(header).toContain('safety_status');
      expect(header).toContain('highest_risk_threat');

      // Check first row has actual values
      const row1 = lines[1];
      expect(row1).toContain('0.000');
      expect(row1).toContain('1.850');
      expect(row1).toContain('4.20');
      expect(row1).toContain('"Storage Rack"');
    });

    it('generates clean descriptive export filenames with timestamp and role', () => {
      recorder.startRecording(0.0, true, 'operator');
      const session = recorder.getCurrentSession()!;

      const jsonName = recorder.generateExportFilename(session, 'json');
      expect(jsonName).toMatch(/^robotrisk_flight_log_REC-.*_auth_.*\.json$/);

      const csvName = recorder.generateExportFilename(session, 'csv');
      expect(csvName).toMatch(/^robotrisk_flight_log_REC-.*_auth_.*\.csv$/);
    });
  });
});
