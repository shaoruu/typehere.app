import composeRefs from '@seznam/compose-react-refs';
import { forwardRef, useEffect, useRef, useState } from 'react';

type EnhancedTextareaProps = {
  id: string;
  text: string;
  setText: (text: string) => void;
  placeholder?: string;
  className?: string;
  spellCheck?: boolean;
  tabSize?: number;
};

export type EnhancedTextareaRefs = {
  getCodeContent: () => string;
};

export const EnhancedTextarea = forwardRef<
  HTMLTextAreaElement,
  EnhancedTextareaProps
>(
  (
    {
      id,
      text,
      setText,
      placeholder = 'Type here...',
      className = undefined,
      tabSize = 4,
      spellCheck = false,
    }: EnhancedTextareaProps,
    ref,
  ) => {
    const [stateSelectionStart, setStateSelectionStart] = useState(0);
    const [stateSelectionEnd, setStateSelectionEnd] = useState(0);

    const txtInput = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
      const textArea = txtInput.current;

      if (!textArea) {
        return;
      }

      if (stateSelectionStart >= 0) {
        textArea.selectionStart = stateSelectionStart;
      }

      if (stateSelectionEnd >= 0) {
        textArea.selectionEnd = stateSelectionEnd;
      }
    }, [text, stateSelectionStart, stateSelectionEnd]);

    async function handleCodeChange(
      e: React.ChangeEvent<HTMLTextAreaElement>,
    ): Promise<void> {
      const text = e.target.value;

      setText(text);
    }

    async function handleKeyDown(
      e: React.KeyboardEvent<HTMLTextAreaElement>,
    ): Promise<void> {
      const textArea = e.target as HTMLTextAreaElement;

      const tabString = ' '.repeat(tabSize);

      const value = textArea.value;
      const selectionStart = textArea.selectionStart;
      const selectionEnd = textArea.selectionEnd;

      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();

        if (selectionStart !== selectionEnd) {
          const slices1 = getNewLineSlices(value, selectionStart, selectionEnd);
          const newValue1 = addTabs(value, slices1, tabString);

          setText(newValue1);
          setStateSelectionStart(selectionStart + tabSize);
          setStateSelectionEnd(
            selectionEnd + (newValue1.length - value.length),
          );
        } else {
          const newValue2 =
            value.substring(0, selectionStart) +
            tabString +
            value.substring(selectionEnd);

          setText(newValue2);
          setStateSelectionStart(
            selectionEnd + tabSize - (selectionEnd - selectionStart),
          );
          setStateSelectionEnd(
            selectionEnd + tabSize - (selectionEnd - selectionStart),
          );
        }
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();

        const slices2 = getNewLineSlices(value, selectionStart, selectionEnd);
        const newValue3 = removeTabs(value, slices2, tabSize);

        const diff = value.length - newValue3.length;

        setText(newValue3);
        setStateSelectionStart(
          Math.max(0, selectionStart - (diff ? tabSize : 0)),
        );
        setStateSelectionEnd(Math.max(0, selectionEnd - diff));
      } else {
        setStateSelectionStart(-1);
        setStateSelectionEnd(-1);
      }
    }

    function getNewLineSlices(
      value: string,
      selectionStart: number,
      selectionEnd: number,
    ): Array<string | null> {
      const newLineLocations = getAllIndices(value, '\n');
      const left = findRange(newLineLocations, selectionStart);
      const split = value.split('\n');

      const arr = [];
      let count = 0;
      for (let i = 0; i < split.length; i++) {
        const line = split[i];

        if (count > left && count <= selectionEnd) {
          arr.push(line);
        } else {
          arr.push(null);
        }

        count += line.length + 1;
      }

      return arr;
    }

    function addTabs(
      value: string,
      arr: Array<string | null>,
      joiner: string,
    ): string {
      const split = value.split('\n');

      let ret = '';
      for (let i = 0; i < split.length; i++) {
        const val = split[i];
        const newLineVal = arr[i];

        if (newLineVal === val) {
          ret += joiner;
        }

        ret += val;
        if (i !== split.length - 1) {
          ret += '\n';
        }
      }

      return ret;
    }

    function removeTabs(
      value: string,
      arr: Array<string | null>,
      tabSize: number,
    ): string {
      const split = value.split('\n');

      let ret = '';
      for (let i = 0; i < split.length; i++) {
        const val = split[i];
        const newLineVal = arr[i];

        if (!val.startsWith(' ') || newLineVal !== val) {
          ret += val;
          if (i !== split.length - 1) {
            ret += '\n';
          }

          continue;
        }

        let count = 1;
        while (val[count] === ' ' && count < tabSize) {
          count++;
        }

        ret += val.substring(count);
        if (i !== split.length - 1) {
          ret += '\n';
        }
      }

      return ret;
    }

    function getAllIndices(arr: string, val: string): Array<number> {
      const indices = [];
      let i = -1;

      while ((i = arr.indexOf(val, i + 1)) !== -1) {
        indices.push(i);
      }

      return indices;
    }

    function findRange(arr: Array<number>, min: number): number {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] >= min) {
          return i === 0 ? -1 : arr[i - 1];
        }
      }

      return arr[arr.length - 1];
    }

    return (
      <textarea
        id={id}
        ref={composeRefs(txtInput, ref)}
        value={text}
        onKeyDown={handleKeyDown}
        onChange={handleCodeChange}
        className={className}
        spellCheck={spellCheck}
        placeholder={placeholder}
        style={{
          margin: '0px 4px',
          outline: 'none',
        }}
      />
    );
  },
);

EnhancedTextarea.displayName = 'EnhancedTextarea';
