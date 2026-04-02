
import React from "react";
import { render } from "ink-testing-library";
import { StatusBar } from "./status.js";
import { describe, it, expect } from "vitest";

describe("StatusBar", () => {
  it("renders 'initializing' state with a custom message", () => {
    const { lastFrame } = render(
      <StatusBar state="initializing" message="Connecting to services..." />
    );
    expect(lastFrame()).toMatchSnapshot();
  });

  it("renders 'retrieving' state with default message", () => {
    const { lastFrame } = render(<StatusBar state="retrieving" message="" />);
    expect(lastFrame()).toMatchSnapshot();
  });

  it("renders 'generating' state with sources count", () => {
    const { lastFrame } = render(
      <StatusBar state="generating" message="" sourcesCount={3} />
    );
    expect(lastFrame()).toMatchSnapshot();
  });

  it("renders 'idle' state as empty string", () => {
    const { lastFrame } = render(<StatusBar state="idle" message="" />);
    expect(lastFrame()).toBe("");
  });

  it("renders 'error' state as empty string", () => {
    const { lastFrame } = render(<StatusBar state="error" message="An error occurred" />);
    expect(lastFrame()).toBe("");
  });
});
