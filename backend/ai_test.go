package main

import (
	"reflect"
	"testing"
)

func TestParseList(t *testing.T) {
	input := "1. 第一条\n- 第二条\n普通段落\n• 第三条\n"
	got := parseList(input)
	want := []string{"第一条", "第二条", "第三条"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseList() = %#v, want %#v", got, want)
	}
}
