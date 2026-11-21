"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSearchParams } from "next/navigation";

const API_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE ||
  "https://qtm-api.onrender.com"
).replace(/\/+$/, "");